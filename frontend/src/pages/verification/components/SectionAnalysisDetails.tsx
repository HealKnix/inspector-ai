import { Button } from "@heroui/react";

import type {
  SectionAnalysisSnapshot,
  SectionEvidence,
  SectionRole,
} from "@/api/types/section-analysis";
import type { SectionEvidenceTarget } from "../lib/evidence-navigation";
import { sectionAssessmentText } from "../lib/object-findings";
import { missingContextText } from "../lib/verification-messages";

const roleLabels: Record<SectionRole, string> = {
  reference: "Эталонный источник",
  actual: "Проверяемый источник",
};

const stageLabels: Record<string, string> = {
  PD: "ПД",
  RD: "РД",
  ID: "ИД",
};

function targetFor(
  targets: readonly SectionEvidenceTarget[] | undefined,
  item: SectionEvidence,
): SectionEvidenceTarget | undefined {
  return targets?.find(
    (target) =>
      target.fileId === item.file_id &&
      target.artifactId === item.artifact_id &&
      target.page === item.page_number &&
      target.role === item.role,
  );
}

/**
 * Замороженная запись анализа разделов внутри находки. Всё содержимое —
 * предварительный результат модели, привязанный к неизменным источникам;
 * оно не меняет статус находки и не заменяет решение инспектора.
 */
export function SectionAnalysisDetails({
  section,
  targets,
  fileNames,
  onLocate,
}: {
  section: SectionAnalysisSnapshot;
  /** Citations resolved to openable frozen files; unresolved ones stay read-only. */
  targets?: readonly SectionEvidenceTarget[];
  fileNames?: ReadonlyMap<string, string>;
  onLocate?: (target: SectionEvidenceTarget) => void;
}) {
  const fileName = (fileId: string) =>
    fileNames?.get(fileId) ?? `Источник ${fileId.slice(0, 8)}`;
  const sourceFor = (sourceRef: string) =>
    section.sources.find((source) => source.source_ref === sourceRef);

  return (
    <div className="grid gap-4">
      <div className="bg-surface-low rounded-[16px] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-xs font-semibold">
            Предварительный результат анализа разделов
          </span>
          {!section.coverage.complete && (
            <span className="bg-warning/10 text-foreground rounded-full px-2.5 py-1 text-xs font-medium">
              Контекст проверен не полностью
            </span>
          )}
        </div>
        <p className="mt-3 text-sm font-medium">
          {sectionAssessmentText[section.assessment]}
        </p>
        {section.fact ? (
          <p className="text-copy-muted mt-2 text-sm leading-6">
            {section.fact}
          </p>
        ) : (
          <p className="text-copy-muted mt-2 text-sm">
            Факт не получен — вывод по этому параметру отсутствует.
          </p>
        )}
        {section.question_for_inspector ? (
          <div className="bg-surface-high mt-3 rounded-xl p-3">
            <h3 className="text-xs font-semibold">Вопрос инспектору</h3>
            <p className="text-copy-muted mt-1 text-sm leading-6">
              {section.question_for_inspector}
            </p>
          </div>
        ) : null}
        {section.missing_context.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold">Недостающий контекст</h3>
            <ul className="text-copy-muted mt-1 list-disc space-y-1 pl-4 text-sm leading-6">
              {section.missing_context.map((item) => (
                <li key={item}>{missingContextText(item)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 min-[880px]:grid-cols-2">
        <div className="bg-surface-low rounded-[16px] p-4">
          <h3 className="text-sm font-semibold">Основание из матрицы</h3>
          {section.matrix ? (
            <>
              <p className="text-copy-muted mt-2 text-sm leading-6">
                {section.matrix.name}
                {section.matrix.unit ? ` · ${section.matrix.unit}` : ""}
              </p>
              {section.matrix.trigger ? (
                <p className="text-copy-muted mt-2 text-xs leading-5">
                  Условие применения: {section.matrix.trigger}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-copy-muted mt-2 text-sm">
              Строка матрицы в записи не сохранена.
            </p>
          )}
          <h3 className="mt-4 text-sm font-semibold">Разделы анализа</h3>
          {section.sections.length === 0 ? (
            <p className="text-copy-muted mt-2 text-sm">
              Границы разделов в записи не сохранены.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {section.sections.map((bound) => {
                const source = sourceFor(bound.source_ref);
                const role: SectionRole | null = source?.role ?? null;
                const bounded =
                  bound.start_page_number !== undefined &&
                  bound.end_page_number !== undefined;
                const pageText = bounded
                  ? bound.start_page_number === bound.end_page_number
                    ? ` · стр. ${bound.start_page_number}`
                    : ` · стр. ${bound.start_page_number}–${bound.end_page_number}`
                  : " · границы по страницам не зафиксированы";
                return (
                  <li key={bound.section_id} className="text-sm">
                    <p className="font-medium">{bound.title}</p>
                    <p className="text-copy-muted text-xs break-all">
                      {role ? roleLabels[role] : "Источник"}
                      {source ? ` · ${fileName(source.file_id)}` : ""}
                      {pageText}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-surface-low rounded-[16px] p-4">
          <h3 className="text-sm font-semibold">Источники анализа</h3>
          <ul className="mt-2 space-y-2">
            {section.sources.map((source) => (
              <li key={source.source_ref} className="text-sm">
                <p className="font-medium">
                  {roleLabels[source.role]}
                  {source.document_stage
                    ? ` · ${stageLabels[source.document_stage] ?? source.document_stage}`
                    : ""}
                </p>
                <p className="text-copy-muted text-xs break-all">
                  {fileName(source.file_id)} · листов: {source.pages.length}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-surface-low rounded-[16px] p-4">
        <h3 className="text-sm font-semibold">Цитаты из источников</h3>
        {section.evidence.length === 0 ? (
          <p className="text-copy-muted mt-2 text-sm">
            Цитат нет — факт не привязан к источникам.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {section.evidence.map((item, index) => {
              const target = targetFor(targets, item);
              return (
                <li
                  className="bg-surface-high rounded-xl px-3 py-2 text-xs leading-5"
                  key={`${item.source_ref}:${item.section_id}:${index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-copy-muted shrink-0">
                      {roleLabels[item.role]} · стр. {item.page_number}
                    </span>
                    {onLocate && target ? (
                      <Button
                        className="shrink-0 rounded-lg"
                        onPress={() => onLocate(target)}
                        size="sm"
                        variant="ghost"
                      >
                        Показать в документе
                      </Button>
                    ) : null}
                  </div>
                  <span className="text-copy-muted mt-1 block break-all">
                    {fileName(item.file_id)}
                  </span>
                  <span className="text-foreground mt-1 block break-words">
                    {item.quote}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {section.coverage.missing.length > 0 && (
          <p className="text-copy-muted mt-3 text-xs">
            {`Непроверенные части: ${[
              ...new Set(section.coverage.missing.map(missingContextText)),
            ].join(" ")}`}
          </p>
        )}
      </div>
    </div>
  );
}
