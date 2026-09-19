import {
  Alert,
  Button,
  Input,
  Label,
  Spinner,
  TextArea,
  TextField,
} from "@heroui/react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useApproveMatrixRule,
  useCreateMatrixRule,
  useDraftMatrixRuleLlm,
  useDryRunMatrixRule,
  useMatrixRows,
  useMatrixRules,
  useRejectMatrixRule,
} from "@/api/hooks/use-matrix";
import type { DryRunResult, MatrixRow } from "@/api/types/matrix";
import routeNames from "@/routes/routeNames";

const ruleStatusLabels: Record<string, string> = {
  draft: "Черновик",
  approved: "Утверждено",
  rejected: "Отклонено",
  deprecated: "Заменено",
};

const outcomeStatusLabels: Record<string, string> = {
  extracted: "извлечено",
  ambiguous: "неоднозначно",
  no_evidence: "нет доказательств",
  unreadable: "нечитаемо",
  unsupported: "не поддерживается",
};

function formatOutcomeValue(value: unknown, unit: string | null) {
  if (value === null || value === undefined) return "—";
  const text =
    typeof value === "number"
      ? value.toLocaleString("ru-RU")
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return `${text}${unit ? ` ${unit}` : ""}`;
}

function DryRunResults({ result }: { result: DryRunResult }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {result.results.map((entry) => (
        <li
          key={`${entry.artifact_id}`}
          className="border-border rounded-xl border px-3 py-2"
        >
          <span className="font-medium break-words">{entry.original_name}</span>
          <span className="text-copy-muted ml-2 text-xs">
            {outcomeStatusLabels[entry.outcome.status] ?? entry.outcome.status}
          </span>
          {entry.outcome.status === "extracted" && (
            <span className="ml-2 font-medium">
              {formatOutcomeValue(entry.outcome.value, entry.outcome.unit)}
            </span>
          )}
          {entry.outcome.status === "ambiguous" &&
            Array.isArray(entry.outcome.alternatives) && (
              <span className="text-warning ml-2 text-xs">
                {(entry.outcome.alternatives as { value: unknown }[])
                  .map((alt) => formatOutcomeValue(alt.value, null))
                  .join(" / ")}
              </span>
            )}
          {entry.outcome.reason && (
            <span className="text-copy-muted ml-2 text-xs">
              {entry.outcome.reason}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RuleEditor({ row }: { row: MatrixRow }) {
  const detail = useMatrixRules(row.parameterCode);
  const createDraft = useCreateMatrixRule();
  const draftLlm = useDraftMatrixRuleLlm();
  const dryRun = useDryRunMatrixRule();
  const approve = useApproveMatrixRule();
  const reject = useRejectMatrixRule();
  const [planText, setPlanText] = useState("");
  const [note, setNote] = useState("");
  const [objectId, setObjectId] = useState("");
  const [fileId, setFileId] = useState("");
  const [terms, setTerms] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  const submitDraft = () => {
    let plan: unknown;
    try {
      plan = JSON.parse(planText) as unknown;
    } catch {
      setPlanError("План должен быть корректным JSON");
      return;
    }
    setPlanError(null);
    createDraft.mutate(
      { parameterCode: row.parameterCode, plan, note: note || undefined },
      { onSuccess: () => setPlanText("") },
    );
  };

  const runDryRun = (ruleId: string) => {
    dryRun.mutate(
      {
        ruleId,
        object_id: objectId,
        file_id: fileId || undefined,
      },
      { onSuccess: setDryRunResult },
    );
  };

  const runDraftLlm = () => {
    draftLlm.mutate({
      parameterCode: row.parameterCode,
      object_id: objectId,
      file_id: fileId || undefined,
      terms: terms
        .split("\n")
        .map((term) => term.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="border-border mt-4 space-y-4 rounded-xl border p-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-copy-muted text-xs">Источник в ПД</p>
          <p className="break-words">{row.sourcePd ?? "—"}</p>
        </div>
        <div>
          <p className="text-copy-muted text-xs">Источник в РД</p>
          <p className="break-words">{row.sourceRd ?? "—"}</p>
        </div>
        <div>
          <p className="text-copy-muted text-xs">Источник в ИД</p>
          <p className="break-words">{row.sourceId ?? "—"}</p>
        </div>
        <div>
          <p className="text-copy-muted text-xs">Триггер</p>
          <p className="break-words">{row.triggerText}</p>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold">Версии правила</h4>
        {detail.isPending && (
          <p role="status" className="text-copy-muted mt-2 text-sm">
            <Spinner size="sm" /> Загружаем версии…
          </p>
        )}
        {detail.data && detail.data.versions.length === 0 && (
          <p className="text-copy-muted mt-2 text-sm">
            Правил пока нет — параметр не проверяется.
          </p>
        )}
        {detail.data && detail.data.versions.length > 0 && (
          <ul className="mt-2 space-y-2">
            {detail.data.versions.map((version) => (
              <li
                key={version.id}
                className="border-border rounded-xl border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">v{version.version}</span>
                  <span
                    className={
                      version.status === "approved"
                        ? "text-success"
                        : version.status === "draft"
                          ? "text-warning"
                          : "text-copy-muted"
                    }
                  >
                    {ruleStatusLabels[version.status] ?? version.status}
                  </span>
                  {version.status === "draft" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={!objectId}
                        isPending={dryRun.isPending}
                        onPress={() => runDryRun(version.id)}
                      >
                        Сухой прогон
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        isPending={approve.isPending}
                        onPress={() => approve.mutate(version.id)}
                      >
                        Утвердить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isPending={reject.isPending}
                        onPress={() => reject.mutate(version.id)}
                      >
                        Отклонить
                      </Button>
                    </>
                  )}
                </div>
                {version.note && (
                  <p className="text-copy-muted mt-1 text-xs break-words">
                    {version.note}
                  </p>
                )}
                <details className="mt-1">
                  <summary className="text-copy-muted cursor-pointer text-xs">
                    План
                  </summary>
                  <pre className="bg-surface-high mt-1 overflow-x-auto rounded-lg p-2 text-xs">
                    {JSON.stringify(version.plan, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField>
          <Label>ID объекта для прогона</Label>
          <Input
            placeholder="uuid объекта"
            value={objectId}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setObjectId(event.target.value)
            }
          />
        </TextField>
        <TextField>
          <Label>ID файла (необязательно)</Label>
          <Input
            placeholder="uuid файла"
            value={fileId}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setFileId(event.target.value)
            }
          />
        </TextField>
      </div>
      <TextField>
        <Label>Поисковые термины для LLM-черновика (по строке на термин)</Label>
        <TextArea
          placeholder="общая площадь&#10;технико-экономические"
          value={terms}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setTerms(event.target.value)
          }
        />
      </TextField>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          isDisabled={!objectId}
          isPending={draftLlm.isPending}
          onPress={runDraftLlm}
        >
          Черновик через LLM
        </Button>
      </div>
      {draftLlm.isError && (
        <p role="alert" className="text-danger text-sm">
          {draftLlm.error.message}
        </p>
      )}
      {draftLlm.data?.warnings?.length ? (
        <Alert status="warning" className="bg-warning/10 shadow-none">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Черновик создан с предупреждениями</Alert.Title>
            <Alert.Description>
              {draftLlm.data.warnings.join(" ")}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {dryRun.isError && (
        <p role="alert" className="text-danger text-sm">
          {dryRun.error.message}
        </p>
      )}
      {dryRunResult && <DryRunResults result={dryRunResult} />}

      <div>
        <h4 className="text-sm font-semibold">Новый черновик вручную</h4>
        <TextField className="mt-2">
          <Label>План (JSON)</Label>
          <TextArea
            placeholder='{"kind":"table_lookup","signature":{"any":["показател"]},"row":{"anchors":["общая площадь"]},"value":{"column":"last_numeric"}}'
            value={planText}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setPlanText(event.target.value)
            }
            rows={4}
          />
        </TextField>
        {planError && (
          <p role="alert" className="text-danger mt-1 text-xs">
            {planError}
          </p>
        )}
        <TextField className="mt-2">
          <Label>Комментарий</Label>
          <Input
            value={note}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setNote(event.target.value)
            }
          />
        </TextField>
        <Button
          className="mt-2"
          size="sm"
          variant="secondary"
          isDisabled={!planText.trim()}
          isPending={createDraft.isPending}
          onPress={submitDraft}
        >
          Создать черновик
        </Button>
        {createDraft.isError && (
          <p role="alert" className="text-danger mt-1 text-sm">
            {createDraft.error.message}
          </p>
        )}
      </div>
      {(approve.isError || reject.isError) && (
        <p role="alert" className="text-danger text-sm">
          {approve.error?.message ?? reject.error?.message}
        </p>
      )}
    </div>
  );
}

export function AdminMatrixPage() {
  const rows = useMatrixRows();
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = rows.isError ? undefined : rows.data;
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1200px] space-y-6 px-4 pt-5 pb-10 sm:px-6 sm:pt-7">
        <header>
          <Link
            className="text-copy-muted hover:text-accent inline-flex items-center gap-2 text-sm"
            to={routeNames.APP}
          >
            На главную
          </Link>
          <h1 className="mt-5 text-[clamp(2rem,3.2vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.045em]">
            Контрольная матрица
          </h1>
          <p className="text-copy-muted mt-3 text-sm leading-6 sm:text-base">
            {data?.items.length ?? "—"} параметров
            {data?.import
              ? ` · источник ${data.import.sourceName} (${data.import.sourceSha256.slice(0, 12)}…)`
              : " · каталог не импортирован"}
          </p>
        </header>
        {rows.isPending && (
          <p role="status" className="text-copy-muted py-8">
            <Spinner size="lg" /> Загружаем матрицу…
          </p>
        )}
        {rows.error && (
          <div role="alert" className="space-y-3">
            <p className="text-danger">{rows.error.message}</p>
            <Button
              variant="outline"
              className="rounded-xl"
              onPress={() => {
                void rows.refetch();
              }}
            >
              Повторить
            </Button>
          </div>
        )}
        {data && (
          <ul className="divide-border border-border divide-y overflow-hidden rounded-[20px] border">
            {data.items.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="hover:bg-surface-high flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 text-left"
                  aria-expanded={expanded === row.parameterCode}
                  onClick={() =>
                    setExpanded(
                      expanded === row.parameterCode ? null : row.parameterCode,
                    )
                  }
                >
                  <span className="text-copy-muted w-14 shrink-0 font-mono text-sm">
                    {row.parameterCode}
                  </span>
                  <span className="min-w-0 flex-1 font-medium break-words">
                    {row.name}
                  </span>
                  <span className="text-copy-muted text-xs">
                    {row.unit ?? "—"} · {row.pdSection}
                  </span>
                  <span className="text-xs">
                    {row.rule_counts?.approved ? (
                      <span className="text-success font-medium">
                        утверждено
                      </span>
                    ) : row.rule_counts?.draft ? (
                      <span className="text-warning">черновик</span>
                    ) : (
                      <span className="text-copy-muted">нет правила</span>
                    )}
                  </span>
                </button>
                {expanded === row.parameterCode && (
                  <div className="px-5 pb-5">
                    <RuleEditor row={row} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
