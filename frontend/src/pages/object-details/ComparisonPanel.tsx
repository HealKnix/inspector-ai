import { Button } from "@heroui/react";

import {
  extractionErrorMessage,
  type useEvidenceGroups,
  type useExtractions,
} from "@/api/hooks/use-extraction";
import type {
  EvidenceGroup,
  ExtractionItem,
  GroupVerdict,
  VerdictMember,
} from "@/api/types/extraction";
import { verdictStatusLabels, verdictWarningLabels } from "./extraction-labels";

function formatMember(member: VerdictMember) {
  const value =
    typeof member.value === "number"
      ? member.value.toLocaleString("ru-RU")
      : member.value;
  return `${value}${member.unit ? ` ${member.unit}` : ""}`;
}

function formatDelta(delta: number | null, deltaPct: number | null) {
  if (delta === null) return null;
  const parts = [`Δ ${delta.toLocaleString("ru-RU")}`];
  if (deltaPct !== null)
    parts.push(
      `${deltaPct.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`,
    );
  return parts.join(" · ");
}

function statusClass(status: GroupVerdict["status"]) {
  if (status === "match") return "text-success";
  if (status === "discrepancy") return "text-danger";
  if (
    status === "expected_ambiguous" ||
    status === "actual_ambiguous" ||
    status === "not_comparable"
  )
    return "text-warning";
  return "text-copy-muted";
}

function pairLabel(result: "match" | "mismatch" | "not_comparable") {
  if (result === "match") return "совпадает";
  if (result === "mismatch") return "расходится";
  return "не сравнить";
}

export function ComparisonPanel({
  objectId,
  groups,
  extraction,
  onOpenEvidence,
}: {
  objectId: string;
  groups: ReturnType<typeof useEvidenceGroups>;
  extraction: ReturnType<typeof useExtractions>;
  onOpenEvidence: (
    fileId: string,
    page: number | null,
    blockId: string | null,
  ) => void;
}) {
  const items = groups.isError ? undefined : groups.data?.items;
  const byExtraction = new Map<string, ExtractionItem>();
  for (const item of extraction.data?.items ?? [])
    byExtraction.set(item.id, item);

  const memberSource = (member: VerdictMember) => {
    const item = byExtraction.get(member.extraction_id);
    const evidence = item?.evidence[0];
    return { name: item?.original_name ?? "документ", evidence };
  };

  const memberLine = (member: VerdictMember, label: string) => {
    const source = memberSource(member);
    const evidence = source.evidence;
    return (
      <div
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        key={member.extraction_id}
      >
        <span className="text-copy-muted text-xs">{label}</span>
        <span className="font-medium">{formatMember(member)}</span>
        <span className="text-copy-muted text-xs break-words">
          {source.name}
        </span>
        {evidence && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Открыть ${source.name}, страница ${evidence.page_number}`}
            onPress={() =>
              onOpenEvidence(
                member.file_id,
                evidence.page_number,
                evidence.block_id,
              )
            }
          >
            Стр. {evidence.page_number}
          </Button>
        )}
      </div>
    );
  };

  const groupBody = (group: EvidenceGroup) => {
    const verdict = group.verdict;
    if (!verdict)
      return (
        <p className="text-copy-muted mt-2 text-xs">
          Сверка ещё не выполнялась для этой группы.
        </p>
      );
    const pairResult = new Map<string, (typeof verdict.pairs)[number]>();
    for (const pair of verdict.pairs)
      if (pair.actual_extraction_id)
        pairResult.set(pair.actual_extraction_id, pair);
    return (
      <div className="mt-2 space-y-1.5 text-sm">
        {verdict.status === "expected_ambiguous" ||
        verdict.status === "actual_ambiguous" ? (
          <ul className="space-y-1">
            {(verdict.status === "expected_ambiguous"
              ? verdict.expected
              : verdict.actual
            )?.map((member) =>
              memberLine(
                member,
                verdict.status === "expected_ambiguous" ? "ПД" : "РД/ИД",
              ),
            )}
          </ul>
        ) : (
          <>
            {verdict.expected?.map((member) => memberLine(member, "ПД"))}
            {verdict.status === "expected_missing" && (
              <p className="text-copy-muted text-xs">
                ПД: извлечённое значение отсутствует
              </p>
            )}
            {verdict.status === "actual_missing" ? (
              <p className="text-copy-muted text-xs">
                РД/ИД: документ со значением не передан — параметр не проверен,
                это не нарушение.
              </p>
            ) : (
              verdict.actual?.map((member) => {
                const pair = pairResult.get(member.extraction_id);
                return (
                  <div key={member.extraction_id}>
                    {memberLine(member, "РД/ИД")}
                    {pair && (
                      <span
                        className={`text-xs ${pair.result === "mismatch" ? "text-danger" : pair.result === "match" ? "text-success" : "text-copy-muted"}`}
                      >
                        {pairLabel(pair.result)}
                        {formatDelta(pair.delta, pair.delta_pct)
                          ? ` · ${formatDelta(pair.delta, pair.delta_pct)}`
                          : ""}
                        {pair.detail ? ` · ${pair.detail}` : ""}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
        {verdict.spec?.kind === "threshold" &&
          verdict.pairs
            .filter(
              (pair) =>
                pair.expected_extraction_id && !pair.actual_extraction_id,
            )
            .map((pair) => (
              <span
                key={pair.expected_extraction_id}
                className={`text-xs ${pair.result === "mismatch" ? "text-danger" : "text-success"}`}
              >
                норматив: {pairLabel(pair.result)}
                {pair.detail ? ` · ${pair.detail}` : ""}
              </span>
            ))}
        {verdict.warnings.length > 0 && (
          <p className="text-warning text-xs">
            {verdict.warnings
              .map((warning) => verdictWarningLabels[warning] ?? warning)
              .join("; ")}
          </p>
        )}
      </div>
    );
  };

  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border"
      aria-labelledby="comparison-title"
    >
      <div className="px-5 py-5">
        <h2 id="comparison-title" className="text-lg font-semibold">
          Сверка ПД ↔ РД/ИД
        </h2>
        <p className="text-copy-muted mt-1 text-xs leading-5">
          Предварительный итог автоматической сверки по утверждённым правилам.
          Это не решение инспектора и не итог протокола.
        </p>
      </div>
      {groups.isPending && (
        <p role="status" className="text-copy-muted px-5 pb-5 text-sm">
          Загружаем результаты сверки…
        </p>
      )}
      {groups.error && (
        <div role="alert" className="space-y-3 px-5 pb-5">
          <p className="text-danger text-sm">
            {extractionErrorMessage(groups.error)}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            isPending={groups.isFetching}
            onPress={() => {
              void groups.refetch();
            }}
          >
            Обновить
          </Button>
        </div>
      )}
      {items && items.length === 0 && (
        <p className="text-copy-muted px-5 pb-5 text-sm">
          Групп доказательств пока нет — сверка появится после извлечения.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-border divide-y">
          {items.map((group) => (
            <li key={`${objectId}:${group.id}`} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-medium break-words">
                  {group.parameter_code}
                </h3>
                {group.verdict && (
                  <span
                    className={`text-sm font-medium ${statusClass(group.verdict.status)}`}
                  >
                    {verdictStatusLabels[group.verdict.status]}
                  </span>
                )}
              </div>
              {groupBody(group)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
