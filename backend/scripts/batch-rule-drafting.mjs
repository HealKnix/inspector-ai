#!/usr/bin/env node
// Массовое драфтинг/прогон/утверждение правил извлечения по 132 строкам матрицы.
//
// Цикл на параметр: draft-llm (план по реальным артефактам) → createDraft с
// comparison-спекой, выведенной из текста триггера → dry-run по артефактам
// объекта → approve, если хотя бы один артефакт дал `extracted`.
// Всё через публичный admin API — аудит и версионирование сохраняются.
//
// Пример:
//   node backend/scripts/batch-rule-drafting.mjs \
//     --api http://localhost:8082 --login admin --password ... \
//     --object <uuid> [--codes P001,P002] [--no-approve] [--out report.json]

const args = parseArgs(process.argv.slice(2));
const API = (args.api ?? "http://localhost:8082").replace(/\/$/, "");
const LOGIN = required(args.login, "--login");
const PASSWORD = required(args.password, "--password");
const OBJECT_ID = required(args.object, "--object");
const ONLY = args.codes ? new Set(args.codes.split(",")) : null;
const AUTO_APPROVE = args["no-approve"] !== true;
const OUT = args.out ?? `batch-rules-${Date.now()}.json`;
const DELAY_MS = Number(args.delay ?? 300);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    out[key] = inline ?? (argv[i + 1]?.startsWith("--") ? true : argv[++i]);
  }
  return out;
}
function required(value, name) {
  if (!value) {
    console.error(`${name} обязателен`);
    process.exit(2);
  }
  return value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Comparison-спека из текста триггера (эвристика v1, подлежит ревизии P4) ---
function deriveComparison(trigger, unit) {
  const t = (trigger ?? "").toLowerCase();
  const pct = t.match(/(?:>|более|превыш\w*)\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (pct) {
    return {
      kind: "numeric_delta",
      tolerance_pct: Number(pct[1].replace(",", ".")),
    };
  }
  const abs = t.match(
    /(?:>|более|превыш\w*|отклонени\w*)\s*(\d+(?:[.,]\d+)?)\s*(м|мм|кв\.?\s?м|м²|м3|м³|квт|кв·?ч|т|шт)\b/,
  );
  if (abs) {
    return {
      kind: "numeric_delta",
      tolerance_abs: Number(abs[1].replace(",", ".")),
    };
  }
  if (/(уменьшени|снижени|сокращени|уже\b|менее\b)/.test(t))
    return { kind: "no_decrease" };
  if (/(увеличени|превышени|больше\b)/.test(t)) return { kind: "no_increase" };
  if (
    /(расхождени|несоответстви|отклонени|совпад|соответству|наличи|изменени)/.test(
      t,
    )
  )
    return { kind: "equals" };
  // Числовой параметр без явного триггера — допуск 0% эквивалентен equals.
  if (unit) return { kind: "numeric_delta", tolerance_pct: 0 };
  // Без узнаваемого триггера сверяем на равенство: расхождение значений —
  // кандидат на проверку инспектором, а не автонарушение.
  return { kind: "equals" };
}

async function api(path, { method = "GET", body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) {
    headers["x-inspector-request"] = "1";
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["x-inspector-request"] = "1";
  } else {
    headers["x-inspector-request"] = "1";
  }
  const response = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: response.status, data };
}

async function login() {
  const res = await api("/auth/login", {
    method: "POST",
    body: { login: LOGIN, password: PASSWORD },
  });
  if (res.status !== 200 || !res.data?.accessToken) {
    throw new Error(`login: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.accessToken;
}

// Access-token живёт 20 минут, а прогон длиннее: 401 → повторный login,
// 429 (throttler) → ожидание и повтор с нарастающей паузой.
let token;
let tokenIssuedAt = 0;
async function call(path, opts = {}, attempt = 0) {
  if (Date.now() - tokenIssuedAt > 900_000) {
    token = await login();
    tokenIssuedAt = Date.now();
  }
  const res = await api(path, { ...opts, token });
  if (res.status === 401 && attempt < 3) {
    token = await login();
    tokenIssuedAt = Date.now();
    return call(path, opts, attempt + 1);
  }
  if (res.status === 429 && attempt < 6) {
    await sleep(15_000 + attempt * 15_000);
    return call(path, opts, attempt + 1);
  }
  return res;
}

async function main() {
  token = await login();
  tokenIssuedAt = Date.now();
  console.log(`API ${API}, объект ${OBJECT_ID}, авто-approve: ${AUTO_APPROVE}`);

  const rowsRes = await api("/v1/admin/matrix/rows", { token });
  if (rowsRes.status !== 200)
    throw new Error(
      `rows: HTTP ${rowsRes.status} ${JSON.stringify(rowsRes.data)}`,
    );
  const rows = rowsRes.data.items ?? rowsRes.data.rows ?? rowsRes.data;
  const targets = rows.filter(
    (row) => !ONLY || ONLY.has(row.parameterCode ?? row.parameter_code),
  );
  console.log(`Строк матрицы: ${rows.length}, в обработку: ${targets.length}`);

  // Файлы объекта, где дословно встречается имя параметра — кандидаты для
  // per-file драфтинга, отсортированные по числу окон с совпадениями.
  async function filesWithNameHits(name) {
    const res = await call(`/v1/admin/matrix/search`, {
      method: "POST",
      body: { object_id: OBJECT_ID, terms: [name] },
    });
    if (res.status !== 200) return [];
    return (res.data.results ?? [])
      .filter((r) => (r.windows ?? []).length > 0)
      .sort((a, b) => b.windows.length - a.windows.length)
      .map((r) => r.file_id);
  }

  const report = [];
  for (const row of targets) {
    const code = row.parameterCode ?? row.parameter_code;
    const name = row.name;
    const trigger = row.triggerText ?? row.trigger ?? "";
    const entry = { parameter_code: code, name, steps: {} };
    try {
      // 1. Уже есть approved-версия — пропускаем.
      const rulesRes = await call(`/v1/admin/matrix/rows/${code}/rules`);
      const rules = rulesRes.data?.versions ?? rulesRes.data?.rules ?? [];
      const approved = rules.find((r) => r.status === "approved");
      if (approved) {
        // Approved без comparison-спеки: довешиваем спеку новой версией —
        // план извлечения уже доказан, dry-run подтверждает актуальность.
        if (approved.comparison == null) {
          const comparison = deriveComparison(trigger, row.unit);
          const res = await call(`/v1/admin/matrix/rows/${code}/rules`, {
            method: "POST",
            body: {
              plan: approved.plan,
              comparison,
              note: `batch: backfill comparison для approved v${approved.version}`,
            },
          });
          if ((res.status !== 200 && res.status !== 201) || !res.data?.rule) {
            entry.final = "backfill_failed";
            entry.steps.backfill = {
              error: `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
            };
            report.push(entry);
            console.log(
              `${code}: backfill comparison не создан — HTTP ${res.status}`,
            );
            continue;
          }
          const target = res.data.rule;
          entry.steps.draft_with_comparison = {
            id: target.id,
            version: target.version,
          };
          const dry = await call(
            `/v1/admin/matrix/rules/${target.id}/dry-run`,
            { method: "POST", body: { object_id: OBJECT_ID } },
          );
          const extracted = (dry.data?.results ?? []).filter(
            (r) => r.outcome?.status === "extracted",
          ).length;
          entry.steps.dry_run = { extracted, comparison };
          if (AUTO_APPROVE && dry.status === 200 && extracted > 0) {
            const ok = await call(
              `/v1/admin/matrix/rules/${target.id}/approve`,
              { method: "POST" },
            );
            entry.final =
              ok.status === 200 ? "comparison_backfilled" : "approve_failed";
          } else {
            entry.final = "backfill_no_extraction";
          }
          report.push(entry);
          console.log(
            `${code}: ${entry.final} (extracted ${extracted}, comparison=${comparison.kind})`,
          );
          continue;
        }
        entry.steps.skip = `approved v${approved.version}`;
        entry.final = "already_approved";
        report.push(entry);
        console.log(`${code}: уже approved v${approved.version}, пропуск`);
        continue;
      }

      // 2. LLM-драфт плана по артефактам объекта (до 2 попыток с разными terms).
      let draft = null;
      let draftError = null;
      for (const terms of [
        undefined,
        [
          name,
          row.unit,
          ...trigger.split(/[,.;]/)[0].split(/\s+/).slice(0, 4),
        ].filter(Boolean),
      ]) {
        const res = await call(`/v1/admin/matrix/rows/${code}/draft-llm`, {
          method: "POST",
          body: { object_id: OBJECT_ID, ...(terms ? { terms } : {}) },
        });
        if ((res.status === 200 || res.status === 201) && res.data?.rule) {
          draft = res.data.rule;
          entry.steps.draft = { id: draft.id, version: draft.version };
          break;
        }
        draftError = `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`;
        await sleep(DELAY_MS);
      }

      // 2b. Fallback: per-file драфт по файлам, где имя параметра встречается
      // дословно. В многофайловом объекте общий бюджет окон может не доставать
      // до нужного документа; драфт по одному файлу даёт ему все 16 окон.
      if (!draft) {
        const files = await filesWithNameHits(name);
        for (const fileId of files.slice(0, 3)) {
          const res = await call(`/v1/admin/matrix/rows/${code}/draft-llm`, {
            method: "POST",
            body: { object_id: OBJECT_ID, file_id: fileId },
          });
          if ((res.status === 200 || res.status === 201) && res.data?.rule) {
            draft = res.data.rule;
            entry.steps.draft = {
              id: draft.id,
              version: draft.version,
              file_id: fileId,
            };
            break;
          }
          draftError = `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`;
          await sleep(DELAY_MS);
        }
      }
      if (!draft) {
        entry.steps.draft = { error: draftError };
        entry.final = "draft_failed";
        report.push(entry);
        console.log(`${code}: драфт не создан — ${draftError}`);
        continue;
      }

      // 3. Comparison-спека из триггера; создаём approvable-драфт со спекой.
      const comparison = deriveComparison(trigger, row.unit);
      entry.steps.comparison = comparison;
      let target = draft;
      if (comparison) {
        const res = await call(`/v1/admin/matrix/rows/${code}/rules`, {
          method: "POST",
          body: {
            plan: draft.plan,
            comparison,
            note: `batch: план llm_draft v${draft.version} + comparison из триггера`,
          },
        });
        if ((res.status === 200 || res.status === 201) && res.data?.rule) {
          target = res.data.rule;
          entry.steps.draft_with_comparison = {
            id: target.id,
            version: target.version,
          };
        } else {
          entry.steps.draft_with_comparison = {
            error: `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
          };
        }
      }

      // 4. Dry-run по всем артефактам объекта.
      const dry = await call(`/v1/admin/matrix/rules/${target.id}/dry-run`, {
        method: "POST",
        body: { object_id: OBJECT_ID },
      });
      if (dry.status !== 200) {
        entry.steps.dry_run = {
          error: `HTTP ${dry.status} ${JSON.stringify(dry.data).slice(0, 200)}`,
        };
        entry.final = "dry_run_failed";
        report.push(entry);
        console.log(`${code}: dry-run ошибка ${dry.status}`);
        continue;
      }
      const outcomes = (dry.data.results ?? []).map((r) => ({
        file_id: r.file_id,
        name: r.original_name,
        status: r.outcome?.status,
        value: r.outcome?.value ?? null,
      }));
      entry.steps.dry_run = { outcomes };
      const extracted = outcomes.filter((o) => o.status === "extracted").length;

      // 5. Авто-approve при хотя бы одном extracted.
      if (AUTO_APPROVE && extracted > 0) {
        const ok = await call(`/v1/admin/matrix/rules/${target.id}/approve`, {
          method: "POST",
        });
        entry.steps.approve =
          ok.status === 200
            ? "approved"
            : `HTTP ${ok.status} ${JSON.stringify(ok.data).slice(0, 160)}`;
        entry.final = ok.status === 200 ? "approved" : "approve_failed";
      } else {
        entry.final =
          extracted > 0
            ? "dry_run_extracted_not_approved"
            : "dry_run_no_extraction";
      }
      console.log(
        `${code}: ${entry.final} (extracted ${extracted}/${outcomes.length}, comparison=${comparison?.kind ?? "—"})`,
      );
    } catch (error) {
      entry.final = "error";
      entry.error = String(error?.message ?? error).slice(0, 300);
      report.push(entry);
      console.log(`${code}: исключение — ${entry.error}`);
      continue;
    }
    report.push(entry);
    await sleep(DELAY_MS);
  }

  const summary = {};
  for (const entry of report)
    summary[entry.final] = (summary[entry.final] ?? 0) + 1;
  console.log("\nИтог:", JSON.stringify(summary, null, 2));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    OUT,
    JSON.stringify(
      { api: API, object_id: OBJECT_ID, summary, report },
      null,
      2,
    ),
  );
  console.log(`Отчёт: ${OUT}`);
}

await main();
