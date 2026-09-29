import { useApproveMatrixRule } from "@/api/hooks/use-matrix";
import {
  useMatrixReview,
  useMatrixReviewContract,
  useRunMatrixRegression,
  useSaveMatrixPassport,
} from "@/api/hooks/use-matrix-review";
import type { MatrixRow, RuleVersion } from "@/api/types/matrix";
import {
  passportInputSchema,
  regressionInputSchema,
  type PassportInput,
  type RegressionReport,
  type RulePassport,
} from "@/api/types/matrix-review";
import { Input } from "@/components/input/Input";
import { Button, Label, TextArea, TextField } from "@heroui/react";
import { useState } from "react";

const categoryLabels: Record<string, string> = {
  positive: "Положительный",
  negative: "Отрицательный",
  boundary: "Граничный",
  uncertain: "Неопределённый",
};

function Report({ report: saved }: { report: RegressionReport }) {
  const report = saved.report;
  return (
    <details
      className="border-border rounded-lg border p-3"
      open={!report.passed}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {report.passed ? "Регрессия пройдена" : "Регрессия не пройдена"} ·{" "}
        {new Date(saved.createdAt).toLocaleString("ru-RU")}
      </summary>
      <p className="text-copy-muted mt-2 text-xs break-all">
        Паспорт: {saved.passportId} · Отчёт: {saved.reportHash}
      </p>
      <p className="mt-2 text-sm">
        Синтетических примеров: {report.quality.synthetic_cases}; отобранных:{" "}
        {report.quality.curated_cases}. Точность на независимом корпусе не
        измерена.
      </p>
      {report.blockers.length > 0 && (
        <ul
          aria-label="Блокирующие условия"
          className="text-danger mt-2 list-inside list-disc text-sm"
        >
          {report.blockers.map((reason, index) => (
            <li key={`${index}-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
      <ul className="mt-3 space-y-2">
        {report.cases.map((item, index) => (
          <li
            key={`${index}-${item.id}`}
            className="bg-surface-high rounded-lg p-2 text-sm"
          >
            <p>
              {item.id} · {item.branch_id} · {categoryLabels[item.category]} ·{" "}
              {item.passed ? "Пройден" : "Ошибка"}
            </p>
            <p className="text-copy-muted text-xs">
              {item.provenance.kind === "synthetic"
                ? "Синтетический пример"
                : "Отобранный пример"}{" "}
              · {item.provenance.reference}
            </p>
            {item.errors.length > 0 && (
              <p className="text-danger mt-1">{item.errors.join("; ")}</p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs">
                Ожидание и фактический результат с локаторами
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto text-xs">
                {JSON.stringify(
                  { expected: item.expected, actual: item.actual },
                  null,
                  2,
                )}
              </pre>
            </details>
          </li>
        ))}
      </ul>
      {report.waivers.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">
            Обоснования неприменимых категорий
          </summary>
          <ul className="mt-1 text-sm">
            {report.waivers.map((waiver) => (
              <li key={`${waiver.branch_id}-${waiver.category}`}>
                {waiver.branch_id} · {categoryLabels[waiver.category]}:{" "}
                {waiver.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  );
}

function initialPassport(
  row: MatrixRow,
  rule: RuleVersion,
  engines: Record<string, string> | undefined,
): PassportInput {
  return {
    schema_version: 1,
    matrix_row_id: row.id,
    quantity: null,
    applicability: null,
    scope: null,
    sources: [],
    unit: row.unit,
    rounding: null,
    branches: ["extraction", ...(rule.comparison ? ["comparison"] : [])].map(
      (operator) => ({
        id: operator,
        operator,
        version: engines?.[operator] ?? "",
        basis_required: false,
        basis: null,
        categories: {
          positive: null,
          negative: null,
          boundary: null,
          uncertain: null,
        },
      }),
    ),
  };
}

function ReviewEditor({
  row,
  rule,
  passport,
  engines,
  approval,
  isRefreshing,
}: {
  row: MatrixRow;
  rule: RuleVersion;
  passport?: RulePassport;
  engines?: Record<string, string>;
  approval?: { eligible: boolean; reason: string | null };
  isRefreshing: boolean;
}) {
  const base = passport
    ? passportInputSchema.parse(
        Object.fromEntries(
          Object.entries(passport.content).filter(([key]) => key !== "source"),
        ),
      )
    : initialPassport(row, rule, engines);
  const [form, setForm] = useState(base);
  const [branches, setBranches] = useState(
    JSON.stringify(base.branches, null, 2),
  );
  const [fixtures, setFixtures] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSaveMatrixPassport();
  const run = useRunMatrixRegression();
  const approve = useApproveMatrixRule();
  const dirty =
    JSON.stringify(form) !== JSON.stringify(base) ||
    branches !== JSON.stringify(base.branches, null, 2);
  const busy =
    save.isPending || run.isPending || approve.isPending || isRefreshing;

  function savePassport() {
    const result = passportInputSchema.safeParse({
      ...form,
      branches: parseJson(branches),
    });
    if (!result.success) {
      setLocalError(
        "Проверьте поля паспорта, источники и JSON ветвей. Для неизвестного значения используйте null; для каждой ветви нужны оператор, версия и четыре категории примеров.",
      );
      return;
    }
    setLocalError(null);
    save.mutate({ ruleId: rule.id, passport: result.data });
  }
  function runRegression() {
    const result = regressionInputSchema.safeParse(parseJson(fixtures));
    if (!result.success) {
      setLocalError(
        "Нужен JSON с schema_version: 1 и непустым массивом fixtures (до 64 примеров). Формат доступен в контракте ниже.",
      );
      return;
    }
    setLocalError(null);
    run.mutate({ ruleId: rule.id, regression: result.data });
  }
  async function upload(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      if (!regressionInputSchema.safeParse(parseJson(text)).success) {
        setLocalError(
          "Файл не соответствует оболочке regression JSON: schema_version и fixtures.",
        );
        return;
      }
      setFixtures(text);
      setLocalError(null);
    } catch {
      setLocalError("Не удалось прочитать файл примеров.");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <h5 className="font-semibold">Паспорт и допуск версии</h5>
      <p className="text-copy-muted text-xs">
        Неизвестные значения оставьте пустыми. Сохранение паспорта создаёт новую
        редакцию и требует новой регрессии.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: "quantity", label: "Проверяемая величина" },
            { key: "applicability", label: "Применимость" },
            { key: "scope", label: "Область проверки" },
            { key: "unit", label: "Единица" },
            { key: "rounding", label: "Округление (если подтверждено)" },
          ] as const
        ).map(({ key, label }) => (
          <Input
            key={key}
            label={label}
            value={form[key] ?? ""}
            onChange={(event) =>
              setForm({ ...form, [key]: event.target.value || null })
            }
          />
        ))}
      </div>
      <fieldset>
        <legend className="mb-1 text-sm">Необходимые источники</legend>
        <div className="flex gap-4">
          {(
            [
              ["PD", "ПД"],
              ["RD", "РД"],
              ["ID", "ИД"],
            ] as const
          ).map(([source, label]) => (
            <label key={source} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.sources.includes(source)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    sources: event.target.checked
                      ? [...form.sources, source]
                      : form.sources.filter((item) => item !== source),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField>
        <Label>Ветви, основания и категории примеров (JSON)</Label>
        <TextArea
          rows={9}
          value={branches}
          onChange={(event) => setBranches(event.target.value)}
        />
      </TextField>
      <p className="text-copy-muted text-xs">
        В categories значение null требует пример. Текст обосновывает
        неприменимость категории. Основание содержит reference, version,
        locator, valid_from и valid_to; неподтверждённое основание — null.
        Версию исполнителя укажите по серверному контракту.
      </p>
      <Button
        size="sm"
        variant="secondary"
        isPending={save.isPending}
        isDisabled={busy || (!!passport && !dirty)}
        onPress={savePassport}
      >
        Сохранить редакцию паспорта
      </Button>
      <TextField>
        <Label>Регрессионные примеры (JSON)</Label>
        <TextArea
          rows={8}
          value={fixtures}
          onChange={(event) => setFixtures(event.target.value)}
          placeholder={'{"schema_version":1,"fixtures":[]}'}
        />
      </TextField>
      <label className="block text-sm">
        Загрузить JSON примеров
        <input
          className="mt-1 block max-w-full text-xs"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <p className="text-copy-muted text-xs">
        Нужны исходные артефакты с hash, ожидаемые значения, единицы, локаторы и
        выводы. Синтетическое происхождение указывается явно; для отобранного
        примера требуется разрешение. Сервер исполняет примеры и сохраняет
        собственный отчёт.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          isPending={run.isPending}
          isDisabled={busy || !passport || dirty || !fixtures.trim()}
          onPress={runRegression}
        >
          Запустить регрессию
        </Button>
        <Button
          size="sm"
          variant="primary"
          isPending={approve.isPending}
          isDisabled={busy || dirty || approval?.eligible !== true}
          onPress={() => approve.mutate(rule.id)}
        >
          Утвердить проверенную версию
        </Button>
      </div>
      <p role="status" className="text-copy-muted text-xs">
        {dirty
          ? "Сначала сохраните изменения паспорта и выполните регрессию."
          : approval?.eligible
            ? "Сервер подтвердил допуск. Утверждение выполняется отдельным действием администратора."
            : (approval?.reason ??
              "Допуск не подтверждён сервером. Утверждение закрыто.")}
      </p>
      {(localError || save.error || run.error || approve.error) && (
        <p role="alert" className="text-danger text-sm">
          {localError ??
            save.error?.message ??
            run.error?.message ??
            approve.error?.message}
        </p>
      )}
    </div>
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function MatrixRuleReview({
  row,
  rule,
}: {
  row: MatrixRow;
  rule: RuleVersion;
}) {
  const review = useMatrixReview(rule.id);
  const contract = useMatrixReviewContract();
  const data = review.isError ? undefined : review.data;
  const passport = data?.passports[0];
  return (
    <div className="mt-3 space-y-3">
      {review.isPending && <p role="status">Загружаем паспорт и отчёты…</p>}
      {review.error && (
        <div role="alert">
          <p className="text-danger">{review.error.message}</p>
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              void review.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      {data?.legacy_without_review && (
        <p className="text-warning text-sm">
          Паспорт отсутствует. Исторический статус версии не подтверждает
          прохождение нового допуска.
        </p>
      )}
      {data && rule.status === "draft" && !contract.isPending && (
        <ReviewEditor
          key={`${rule.id}-${passport?.id ?? "new"}`}
          row={row}
          rule={rule}
          passport={passport}
          engines={contract.data?.engines}
          approval={data.approval}
          isRefreshing={review.isFetching}
        />
      )}
      {contract.error && (
        <p role="alert" className="text-danger text-sm">
          Не удалось загрузить контракт примеров: {contract.error.message}
        </p>
      )}
      {contract.data && (
        <details>
          <summary className="text-copy-muted cursor-pointer text-xs">
            Формат паспорта и примеров, полученный от сервера
          </summary>
          <pre className="bg-surface-high mt-2 max-h-72 overflow-auto rounded-lg p-2 text-xs">
            {JSON.stringify(contract.data, null, 2)}
          </pre>
        </details>
      )}
      {data && (
        <>
          <details>
            <summary className="cursor-pointer text-sm">
              История паспортов ({data.passports.length})
            </summary>
            {data.passports.map((item) => (
              <details className="mt-2" key={item.id}>
                <summary className="cursor-pointer text-xs">
                  Редакция {item.revision} ·{" "}
                  {new Date(item.createdAt).toLocaleString("ru-RU")} ·{" "}
                  {item.contentHash.slice(0, 12)}…
                </summary>
                <pre className="bg-surface-high mt-1 max-h-72 overflow-auto rounded-lg p-2 text-xs">
                  {JSON.stringify(item.content, null, 2)}
                </pre>
              </details>
            ))}
          </details>
          <p className="text-sm font-medium">
            Отчёты регрессий ({data.reports.length}; до 100 последних)
          </p>
          {data.reports.length === 0 && (
            <p className="text-copy-muted text-sm">
              Отчётов пока нет. Сухой прогон не заменяет проверку примеров.
            </p>
          )}
          {data.reports.map((report) => (
            <Report key={report.id} report={report} />
          ))}
        </>
      )}
    </div>
  );
}
