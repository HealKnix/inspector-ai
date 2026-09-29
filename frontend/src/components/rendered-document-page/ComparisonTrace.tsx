import type {
  ComparisonSourceTarget,
  CompositeBranchTrace,
  CompositeComparisonTrace,
} from "@/api/types/composite-comparison";
import { Button } from "@heroui/react";
import { verdictStatusLabels, verdictWarningLabels } from "./extraction-labels";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "—";
}
const reasons: Record<string, string> = {
  unit_missing: "В документе не подтверждена единица измерения.",
  unit_dimension_mismatch:
    "Единицы неизвестны или относятся к разным величинам.",
  unit_evidence_mismatch: "Единица значения не совпадает с её доказательством.",
  numerical_evidence_missing: "Нет подтверждённых численных оснований.",
  numerical_value_evidence_mismatch:
    "Значение не совпадает с сохранённым численным основанием.",
  numerical_unit_evidence_invalid:
    "Не подтверждён фрагмент с единицей измерения.",
  percent_fraction_not_authorized:
    "Правило не разрешает перевод процентов в долю или обратно.",
  zero_expected_not_comparable:
    "Относительный допуск при нулевом эталоне не определён.",
  zero_expected_absolute_tolerance_missing:
    "Для нулевого эталона требуется подтверждённый абсолютный допуск.",
  uncertainty_crosses_boundary:
    "Интервал неопределённости пересекает границу условия.",
  category_not_in_rank_map: "Категории нет в подтверждённом справочнике.",
};
export function ComparisonTrace({
  trace,
  composite,
  sources = [],
  onOpenSource,
}: {
  trace?: Record<string, unknown>;
  composite?: CompositeComparisonTrace;
  sources?: readonly ComparisonSourceTarget[];
  onOpenSource?: (source: ComparisonSourceTarget) => void;
}) {
  if (composite)
    return (
      <CompositeTrace
        composite={composite}
        sources={sources}
        onOpenSource={onOpenSource}
      />
    );
  if (!trace) return null;
  const policy = record(trace.policy);
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer">Значения и основания расчёта</summary>
      {(["expected", "actual"] as const).map((role) => {
        const side = record(trace[role]);
        if (!side) return null;
        const unit = record(side.source_unit),
          conversion = record(side.conversion),
          interval = record(side.interval);
        const unitEvidence = Array.isArray(unit?.evidence)
          ? unit.evidence.map(record).filter((proof) => proof !== null)
          : [];
        return (
          <div key={role} className="mt-2">
            <p className="font-medium">
              {role === "expected" ? "ПД" : "РД/ИД"}: {text(side.raw)}
            </p>
            {trace.kind === "numerical" ? (
              <>
                <p>
                  Точное значение: {text(side.decimal)} {text(unit?.canonical)}{" "}
                  → {text(side.converted)} {text(policy?.target_unit)}
                </p>
                <p>
                  Множитель перевода: {text(conversion?.factor)}; после
                  округления: {text(side.rounded)}
                </p>
                {interval && (
                  <p>
                    Интервал: [{text(interval.lower)}; {text(interval.upper)}]
                  </p>
                )}
                {unitEvidence.map((proof, index) => (
                  <p key={index}>
                    Единица в источнике, стр. {text(proof.page_number)}: «
                    {text(proof.quote)}»
                  </p>
                ))}
              </>
            ) : (
              <p>
                Категория: {text(side.category)}; ранг по справочнику:{" "}
                {text(side.rank)}
              </p>
            )}
          </div>
        );
      })}
      {trace.kind === "numerical" ? (
        <p className="mt-2">
          Точная разность: {text(trace.delta)} {text(policy?.target_unit)}.
          Округление:{" "}
          {policy?.rounding === null
            ? "не применяется"
            : `${text(record(policy?.rounding)?.mode)}, знаков: ${text(record(policy?.rounding)?.scale)}`}
          .
        </p>
      ) : (
        <p className="mt-2">
          Справочник: {text(trace.map_version)}. Основание:{" "}
          {text(record(trace.basis)?.reference)},{" "}
          {text(record(trace.basis)?.version)},{" "}
          {text(record(trace.basis)?.locator)}.
        </p>
      )}
      {typeof trace.reason === "string" && (
        <p>
          Причина неопределённости:{" "}
          {reasons[trace.reason] ??
            "Оснований для достоверного сравнения недостаточно."}
        </p>
      )}
    </details>
  );
}

const branchReasons: Record<string, string> = {
  unit_mismatch: "Единицы измерения источников не совпадают.",
  type_mismatch: "Источники содержат значения разных типов.",
  non_numeric: "Для числового сравнения не найдено числовое значение.",
  unclassified_members: "Вид части документов ещё не определён.",
  applicability_unknown: "Применимость условия ещё не подтверждена.",
  not_applicable: "Условие неприменимо в выбранной области.",
  context_missing: "Не зафиксирован общий контекст документов и редакций.",
  context_mismatch: "Источники относятся к разным областям или редакциям.",
  expected_missing: "Нет подтверждённого значения в эталонном документе.",
  actual_missing: "Нет подтверждённого значения в проверяемом документе.",
  expected_ambiguous: "В эталонных источниках есть неоднозначные значения.",
  actual_ambiguous: "В проверяемых источниках есть неоднозначные значения.",
  not_comparable: "Источники не позволяют достоверно сравнить эту ветвь.",
  no_comparison: "Для ветви не задано исполняемое сравнение.",
};
function branchReason(code: string) {
  const normalized = code.startsWith("scalar_")
    ? code.slice("scalar_".length)
    : code;
  if (normalized.startsWith("below_min:"))
    return "Значение ниже допустимой границы.";
  if (normalized.startsWith("above_max:"))
    return "Значение выше допустимой границы.";
  return (
    branchReasons[normalized] ??
    verdictWarningLabels[normalized] ??
    reasons[normalized] ??
    "Для этой ветви требуется уточнение исходных данных."
  );
}
const outcomeLabels = {
  true: "Условие выполнено",
  false: "Условие не выполнено",
  unknown: "Недостаточно данных для вывода",
} as const;
const operatorLabels: Record<string, string> = {
  equals: "Совпадение значений",
  numeric_delta: "Отклонение в пределах допуска",
  no_decrease: "Без уменьшения",
  no_increase: "Без увеличения",
  threshold: "Нормативная граница",
  ordered_category: "Порядок категорий",
};
type NavigationProps = {
  sources: readonly ComparisonSourceTarget[];
  onOpenSource?: (source: ComparisonSourceTarget) => void;
};

function CompositeTrace({
  composite,
  sources,
  onOpenSource,
}: { composite: CompositeComparisonTrace } & NavigationProps) {
  return (
    <details className="border-border mt-3 rounded-lg border p-3 text-sm" open>
      <summary className="cursor-pointer font-medium">
        Составное условие · {outcomeLabels[composite.result]}
      </summary>
      <p className="text-copy-muted mt-2 text-xs">
        Предварительный результат правила. Решение инспектора принимается
        отдельно.
      </p>
      <p className="mt-2 text-xs">
        Применимость:{" "}
        {composite.applicability === "applicable"
          ? "подтверждена"
          : composite.applicability === "not_applicable"
            ? "условие неприменимо"
            : "не подтверждена"}
        .
      </p>
      {composite.context && (
        <p className="text-copy-muted mt-1 text-xs">
          Область: {composite.context.scope_key}; период:{" "}
          {composite.context.period_key ?? "не указан"}.{" "}
          {composite.context.applicability_basis
            ? `Основание применимости: ${composite.context.applicability_basis}`
            : "Основание применимости не указано."}
        </p>
      )}
      <BranchTrace
        branch={composite.root}
        determining={false}
        sources={sources}
        onOpenSource={onOpenSource}
      />
    </details>
  );
}
function BranchTrace({
  branch,
  determining,
  sources,
  onOpenSource,
}: { branch: CompositeBranchTrace; determining: boolean } & NavigationProps) {
  const targets = sources.filter((target) =>
    branch.sources.some(
      (source) =>
        source.artifact_id !== null &&
        source.extraction_id === target.extractionId &&
        source.file_id === target.fileId &&
        source.artifact_id === target.artifactId,
    ),
  );
  return (
    <section
      className="border-border mt-3 border-l-2 pl-3"
      aria-label={`Ветвь ${branch.id}`}
    >
      <p className="font-medium">
        {branch.id} ·{" "}
        {branch.kind === "and"
          ? "И: нужны все условия"
          : branch.kind === "or"
            ? "ИЛИ: достаточно одного условия"
            : (operatorLabels[branch.scalar?.spec?.kind ?? ""] ??
              "Скалярное условие")}
      </p>
      <p className="mt-1 text-xs">
        {!branch.evaluated ? "Не вычислялась" : outcomeLabels[branch.result]}
        {determining ? " · Определяет результат родительского условия" : ""}
      </p>
      {branch.applicability !== "applicable" && (
        <p className="text-warning mt-1 text-xs">
          {branch.applicability === "not_applicable"
            ? "Условие неприменимо."
            : "Применимость не подтверждена."}
        </p>
      )}
      {branch.reasons.length > 0 && (
        <ul className="text-copy-muted mt-1 list-inside list-disc text-xs">
          {[...new Set(branch.reasons.map(branchReason))].map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {branch.kind === "scalar" && (
        <>
          {branch.scalar && (
            <p className="mt-2 text-xs">
              Сравнение: {verdictStatusLabels[branch.scalar.status]}.
            </p>
          )}
          {branch.scalar?.pairs.map((pair, index) => (
            <ComparisonTrace key={index} trace={pair.trace} />
          ))}
          {targets.length > 0 && onOpenSource ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {targets.map((target, index) => (
                <Button
                  key={`${target.extractionId}:${target.artifactId}:${target.page}:${index}`}
                  size="sm"
                  variant="ghost"
                  onPress={() => onOpenSource(target)}
                  aria-label={`Ветвь ${branch.id}: ${target.label}, страница ${target.page}`}
                >
                  {target.label} · стр. {target.page}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-copy-muted mt-2 text-xs">
              Переход к источнику недоступен: нет совместимого зафиксированного
              локатора.
            </p>
          )}
        </>
      )}
      {branch.children.map((child) => (
        <BranchTrace
          key={child.id}
          branch={child}
          determining={branch.determining_branch_ids.includes(child.id)}
          sources={sources}
          onOpenSource={onOpenSource}
        />
      ))}
    </section>
  );
}
