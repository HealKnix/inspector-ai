import type {
  ApiFinding,
  FindingsResponse,
  ProtocolResponse,
} from "@/api/types/verification";
import { describeFinding } from "../lib/object-findings";
import {
  coverageStatusLabels,
  MATRIX_PARAMETER_TARGET,
  parameterCoverage,
} from "../lib/parameter-coverage";

export function ParameterCoverage({
  protocol,
  items,
  loading,
  error,
  release,
}: {
  protocol: NonNullable<ProtocolResponse["protocol"]>;
  items: readonly ApiFinding[] | undefined;
  loading: boolean;
  error: boolean;
  release?: FindingsResponse["rule_release"];
}) {
  const coverage = parameterCoverage(items);
  return (
    <section
      aria-label="Покрытие параметров"
      className="border-border bg-card mt-4 rounded-xl border p-4"
    >
      <h2 className="text-base font-semibold">
        Покрытие параметров · целевая матрица {MATRIX_PARAMETER_TARGET}
      </h2>
      <p className="mt-2 text-sm">
        {release
          ? `В выпуске: ${release.executable_parameters} исполнимых правил; допущено через проверку паспортов и регрессию: ${release.admitted_parameters}/132.`
          : "Состав исторического выпуска не зафиксирован; предметный допуск неизвестен."}
      </p>
      {release && (
        <p className="text-copy-muted text-xs break-all">
          Выпуск: {release.manifest_hash}
        </p>
      )}
      <p className="text-copy-muted mt-1 text-xs">
        Сохранённая версия протокола {protocol.version}. Готовность правил и
        точность на корпусе этим протоколом не измеряются.
      </p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-copy-muted">Параметров в снимке протокола</dt>
          <dd className="font-semibold">
            {protocol.parameters ?? "Неизвестно"}
          </dd>
        </div>
        <div>
          <dt className="text-copy-muted">Сравнено при формировании снимка</dt>
          <dd className="font-semibold">
            {protocol.parameters_compared ?? "Неизвестно"}
          </dd>
        </div>
        <div>
          <dt className="text-copy-muted">
            Параметров в загруженных результатах
          </dt>
          <dd className="font-semibold">
            {coverage?.observedParameters ?? "Неизвестно"}
          </dd>
        </div>
      </dl>
      {loading && !coverage && (
        <p className="text-copy-muted mt-3 text-sm" role="status">
          Загружаем результаты покрытия…
        </p>
      )}
      {error && (
        <p className="text-danger mt-3 text-sm" role="alert">
          Результаты покрытия не загружены. Отсутствие данных не означает
          нулевое число проблем.
        </p>
      )}
      {coverage && (
        <>
          {protocol.parameters != null &&
            protocol.parameters !== coverage.observedParameters && (
              <p className="text-warning mt-3 text-sm">
                Количество параметров в ответе отличается от сохранённого
                счётчика. Полнота списка не подтверждена.
              </p>
            )}
          <p className="text-copy-muted mt-3 text-xs">
            Контрольных точек по областям: {coverage.controlPoints}. С
            блокирующей причиной «правило не утверждено»:{" "}
            {coverage.unavailableRules} параметров. Это не счётчик всех
            допущенных правил.
          </p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(coverage.statusCounts).map(([status, count]) => (
              <div key={status} className="bg-surface-high rounded-lg p-2">
                <dt>
                  {
                    coverageStatusLabels[
                      status as keyof typeof coverageStatusLabels
                    ]
                  }
                </dt>
                <dd className="mt-1 font-semibold">{count}</dd>
              </div>
            ))}
          </dl>
          <p className="text-copy-muted mt-3 text-xs">
            Счётчики статусов относятся к контрольным точкам: один параметр
            может проверяться в нескольких областях. Несопоставимость,
            недостаток доказательств и неприменимость показаны раздельно.
            Финализация не подтверждает проверку всех 132 параметров.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Все результаты по параметрам ({coverage.observedParameters})
            </summary>
            <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
              {coverage.parameters.map(({ code, findings }) => (
                <li key={code} className="border-border rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {code}
                    {findings[0]?.parameter_name
                      ? ` · ${findings[0].parameter_name}`
                      : ""}
                  </p>
                  <ul className="mt-2 space-y-2 text-xs">
                    {findings.map((finding) => (
                      <li key={finding.id}>
                        <p className="font-medium">
                          {finding.status === "NEGATIVE_VERIFIED" &&
                          finding.verdict?.status === "match" &&
                          !finding.decided_at
                            ? "Совпадает"
                            : coverageStatusLabels[finding.status]}{" "}
                          ·{" "}
                          {finding.scope_key === "object"
                            ? "Объект"
                            : finding.scope_key}
                        </p>
                        <p className="text-copy-muted mt-1">
                          {describeFinding(finding)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
