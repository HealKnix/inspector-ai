import type {
  IdentificationRegistry,
  IdentificationRevision,
} from "@/api/types/identification";
import { Button } from "@heroui/react";
import {
  resolveSelectedSheet,
  sheetContextsForRevision,
  type ResolvedSheetNavigation,
} from "../lib/resolved-sheet-selection";

export function ResolvedSheetSelection({
  registry,
  revision,
  filenames,
  unavailable,
  onOpen,
}: {
  registry: IdentificationRegistry;
  revision: IdentificationRevision;
  filenames: Map<string, string>;
  unavailable: boolean;
  onOpen: (target: ResolvedSheetNavigation) => void;
}) {
  const contexts = sheetContextsForRevision(registry, revision.revision_id);
  if (!contexts.length) return null;
  return (
    <details className="border-border border-t pt-3 text-sm" open>
      <summary className="cursor-pointer font-medium">
        Выбранные наборы листов
      </summary>
      <p className="text-copy-muted mt-2 text-xs">
        Состав из сохранённого снимка. Обозначение листа и страница PDF показаны
        отдельно; каждый лист открывает свой исходный файл.
      </p>
      <div className="mt-3 space-y-4">
        {contexts.map((context) => (
          <section
            key={context.context_id}
            aria-label={`Листы контекста ${context.scope}`}
            className="border-border rounded-lg border p-3"
          >
            <h3 className="font-medium">
              {context.scope || "Область не указана"}
            </h3>
            <p className="text-copy-muted mt-1 text-xs">
              Период работ: {context.works_period.from ?? "начало не указано"} —{" "}
              {context.works_period.to ?? "окончание не указано"}.{" "}
              {context.status === "READY"
                ? "Контекст подготовлен к сравнению."
                : "Контекст требует уточнения; сохранённый состав сам по себе не подтверждает готовность сравнения."}
            </p>
            {(["reference", "actual"] as const).map((role) => {
              const selection = context.sheet_selection?.[role];
              const roleLabel =
                role === "reference" ? "Эталонный набор" : "Проверяемый набор";
              const headRevision = context[role]?.revision_id;
              if (!selection)
                return (
                  <p key={role} className="text-copy-muted mt-3 text-xs">
                    {roleLabel}: набор листов не зафиксирован.
                  </p>
                );
              return (
                <section key={role} aria-label={roleLabel} className="mt-3">
                  <h4 className="font-medium">
                    {roleLabel} · {selection.sheets.length} листов
                  </h4>
                  <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                    {selection.sheets.map((sheet) => {
                      const source = resolveSelectedSheet(
                        registry,
                        selection,
                        sheet,
                      );
                      const revisionLabel =
                        source?.revision.fields.revision_label ??
                        sheet.revision_id;
                      return (
                        <li
                          key={`${sheet.label}:${sheet.revision_id}:${sheet.file_id}:${sheet.page_number}`}
                          className="bg-surface-high space-y-1 rounded-lg p-2 text-xs"
                        >
                          <p className="font-medium">
                            Лист {sheet.label} → страница PDF{" "}
                            {sheet.page_number}
                          </p>
                          <p>
                            {filenames.get(sheet.file_id) ??
                              `Файл ${sheet.file_id}`}{" "}
                            · редакция {revisionLabel} ·{" "}
                            {sheet.revision_id === headRevision
                              ? "из выбранной редакции"
                              : "сохранён из предшествующей редакции"}
                          </p>
                          {source ? (
                            <>
                              <p className="text-copy-muted">
                                Основание карты: {source.mapBasis}
                              </p>
                              <Button
                                size="sm"
                                variant="ghost"
                                isDisabled={unavailable}
                                onPress={() =>
                                  onOpen({
                                    ...source,
                                    label: sheet.label,
                                    contextLabel: context.scope,
                                    roleLabel,
                                  })
                                }
                                aria-label={`Открыть лист ${sheet.label}, ${roleLabel.toLocaleLowerCase("ru-RU")}, страница PDF ${sheet.page_number}`}
                              >
                                Открыть исходную страницу
                              </Button>
                            </>
                          ) : (
                            <p className="text-warning">
                              Сохранённый источник или его карта недоступны в
                              этом снимке. Переход к другой редакции не
                              подставляется.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <details className="mt-2">
                    <summary className="text-copy-muted cursor-pointer text-xs">
                      Основания цепочки редакций
                    </summary>
                    <ul className="mt-2 space-y-2 text-xs">
                      {selection.chain.map((entry) => {
                        const saved = registry.documents
                          .flatMap((document) => document.revisions)
                          .find(
                            (item) => item.revision_id === entry.revision_id,
                          );
                        return (
                          <li key={entry.revision_id}>
                            <p>
                              Редакция{" "}
                              {saved?.fields.revision_label ??
                                entry.revision_id}
                            </p>
                            <p>
                              Карта:{" "}
                              {saved?.sheet_map?.basis ??
                                "основание недоступно"}
                            </p>
                            {saved?.sheet_replacement && (
                              <p>
                                Замена листов{" "}
                                {saved.sheet_replacement.replaced_labels.join(
                                  ", ",
                                )}
                                : {saved.sheet_replacement.basis}
                              </p>
                            )}
                            <p className="text-copy-muted break-all">
                              Контрольная сумма решения: {entry.decision_hash}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-copy-muted mt-2 text-xs break-all">
                      Контрольная сумма выбранного набора:{" "}
                      {selection.selection_hash}
                    </p>
                  </details>
                </section>
              );
            })}
          </section>
        ))}
      </div>
    </details>
  );
}
