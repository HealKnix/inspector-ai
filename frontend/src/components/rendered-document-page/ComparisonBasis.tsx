function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
const text = (value: unknown) =>
  typeof value === "string" ? value : "Не установлено";

/** The passport comes from the immutable finding, never the current admin rule. */
export function ComparisonBasis({
  basis,
}: {
  basis?: Record<string, unknown>;
}) {
  const content = record(basis?.content);
  if (!content) return null;
  const branches = Array.isArray(content.branches)
    ? content.branches.map(record).filter((branch) => branch !== null)
    : [];
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer">
        Основания правила в этом расчёте
      </summary>
      <p className="mt-2">
        Величина: {text(content.quantity)}. Область: {text(content.scope)}.
      </p>
      <p>Применимость: {text(content.applicability)}.</p>
      <p>Условие матрицы: {text(record(content.source)?.trigger)}.</p>
      {branches.map((branch) => {
        const reference = record(branch.basis);
        return reference ? (
          <p key={text(branch.id)}>
            {text(branch.id)}: {text(reference.reference)}; редакция{" "}
            {text(reference.version)}; {text(reference.locator)}.
          </p>
        ) : null;
      })}
    </details>
  );
}
