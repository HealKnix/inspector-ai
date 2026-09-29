import type {
  IdentificationRegistry,
  IdentificationRevision,
} from "@/api/types/identification";
import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { Input } from "@/components/input/Input";
import { Button, Checkbox } from "@heroui/react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { reviewDocumentName } from "../lib/review-card";
import type { ReviewFormValues } from "../lib/review-form";
import {
  initialSheetReview,
  predecessorSheetLabels,
  sheetMapRepresentation,
  sheetPredecessors,
  type OriginalPageTarget,
} from "../lib/sheet-review";

export function SheetMapQuestion({
  form,
  revision,
  registry,
  filenames,
  disabled,
  onPage,
}: {
  form: UseFormReturn<ReviewFormValues>;
  revision: IdentificationRevision;
  registry: IdentificationRegistry;
  filenames: Map<string, string>;
  disabled: boolean;
  onPage: (target: OriginalPageTarget) => void;
}) {
  const draft = useWatch({ control: form.control, name: "sheets" });
  const source = sheetMapRepresentation(revision);
  const candidates = sheetPredecessors(registry, revision);
  const selectedPredecessor = candidates.find(
    (item) => item.revision.revision_id === draft.predecessor,
  );
  const previousLabels = selectedPredecessor
    ? predecessorSheetLabels(registry, selectedPredecessor.revision)
    : [];
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) =>
    form.setValue(
      "sheets",
      { ...form.getValues("sheets"), [key]: value },
      { shouldDirty: true },
    );
  const map = revision.sheet_map;
  const relation = revision.sheet_replacement;
  const savedSource = revision.representations.find(
    (item) =>
      item.file_id === map?.file_id && item.source_sha256 === map.source_sha256,
  );
  const savedPredecessor = registry.documents
    .flatMap((document) =>
      document.revisions.map((candidate) => ({
        document,
        revision: candidate,
      })),
    )
    .find(
      (item) => item.revision.revision_id === relation?.predecessor_revision_id,
    );
  if (!source && !map && !relation) return null;
  const pageButton = (page: number, representation = source) =>
    representation ? (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onPress={() => onPage({ ...representation, page_number: page })}
      >
        Страница PDF {page}
      </Button>
    ) : (
      <span>Страница PDF {page}</span>
    );
  return (
    <details
      className="border-border space-y-3 border-t pt-3 text-sm"
      open={
        revision.blockers.includes("unsupported_partial_replacement") ||
        undefined
      }
    >
      <summary className="cursor-pointer font-medium">
        Карта листов и частичная замена
      </summary>
      <p className="text-copy-muted">
        Обозначение листа берётся из оригинала и может отличаться от номера
        страницы PDF. Карта определяет источники для проверки. Утверждение
        редакции, сроки действия и комплектность подтверждаются отдельно.
      </p>
      {map && draft.mapAction === "unchanged" ? (
        <div className="space-y-2" aria-label="Сохранённая карта листов">
          <p>{filenames.get(map.file_id) ?? "Исходный PDF"}</p>
          <ul className="max-h-64 space-y-1 overflow-auto">
            {map.sheets.map((sheet) => (
              <li key={sheet.label}>
                Лист {sheet.label} →{" "}
                {pageButton(sheet.page_number, savedSource ?? null)}
              </li>
            ))}
          </ul>
          <p>
            Исключённые страницы PDF: {map.excluded_pages.join(", ") || "нет"}.
          </p>
          <p>Основание карты: {map.basis}</p>
        </div>
      ) : draft.mapAction === "clear" ? (
        <p>После сохранения карта листов будет снята. История сохранится.</p>
      ) : draft.mapAction === "unchanged" ? (
        <p>Карта листов не подтверждена.</p>
      ) : null}
      {!disabled && source && draft.mapAction !== "replace" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onPress={() => set("mapAction", "replace")}
        >
          Уточнить карту листов
        </Button>
      ) : null}
      {draft.mapAction === "replace" && source ? (
        <div className="space-y-3" aria-label="Редактор карты листов">
          <p>
            Укажите обозначение для каждой страницы или явно исключите её из
            извлечения. Например, страницу разрешения можно исключить, сохранив
            основание ниже.
          </p>
          <div className="max-h-96 space-y-3 overflow-auto pr-1">
            {draft.pages.map((page, index) => (
              <div
                key={index}
                className="border-border grid gap-2 rounded-lg border p-2 sm:grid-cols-[auto_minmax(0,1fr)]"
              >
                {pageButton(index + 1)}
                <Input
                  label={`Лист на странице PDF ${index + 1}`}
                  value={page.label}
                  maxLength={80}
                  isDisabled={disabled || page.excluded}
                  onChange={(event) =>
                    form.setValue(
                      `sheets.pages.${index}.label`,
                      event.target.value,
                      { shouldDirty: true },
                    )
                  }
                />
                <Checkbox
                  className="sm:col-span-2"
                  isSelected={page.excluded}
                  isDisabled={disabled}
                  onChange={(value) => {
                    form.setValue(`sheets.pages.${index}.excluded`, value, {
                      shouldDirty: true,
                    });
                    if (value)
                      form.setValue(`sheets.pages.${index}.label`, "", {
                        shouldDirty: true,
                      });
                  }}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    Исключить страницу PDF {index + 1}
                  </Checkbox.Content>
                </Checkbox>
              </div>
            ))}
          </div>
          <Input
            label="Основание карты листов и исключений"
            value={draft.mapBasis}
            maxLength={4000}
            isDisabled={disabled}
            onChange={(event) => set("mapBasis", event.target.value)}
          />
        </div>
      ) : null}
      {!source && map ? (
        <p>
          Изменение карты недоступно: требуется один самостоятельный PDF до 500
          страниц.
        </p>
      ) : null}
      {!disabled && map && draft.mapAction !== "clear" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onPress={() => set("mapAction", "clear")}
        >
          Снять карту листов
        </Button>
      ) : null}
      {relation && draft.replacementAction === "unchanged" ? (
        <div className="space-y-1" aria-label="Сохранённая частичная замена">
          <p>
            Предшествующая редакция:{" "}
            {savedPredecessor
              ? reviewDocumentName(
                  savedPredecessor.document,
                  filenames,
                  savedPredecessor.revision,
                )
              : "сохранённая редакция недоступна в этом снимке"}
            .
          </p>
          <p>Заменены листы: {relation.replaced_labels.join(", ")}.</p>
          <p>Основание замены: {relation.basis}</p>
        </div>
      ) : draft.replacementAction === "clear" ? (
        <p>
          После сохранения частичная замена будет снята. История сохранится.
        </p>
      ) : null}
      {!disabled && source && draft.replacementAction !== "replace" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onPress={() => set("replacementAction", "replace")}
        >
          Уточнить замену отдельных листов
        </Button>
      ) : null}
      {draft.replacementAction === "replace" ? (
        <div className="space-y-3" aria-label="Редактор частичной замены">
          <p>
            Допустима замена существующих листов 1:1. Добавление, удаление и
            перенумерация требуют отдельного уточнения. Утверждение не меняется
            автоматически.
          </p>
          <IdentificationSelect
            label="Предшествующая редакция для замены листов"
            value={draft.predecessor}
            disabled={disabled}
            options={candidates.map((item) => ({
              id: item.revision.revision_id,
              label: `${reviewDocumentName(item.document, filenames, item.revision)} · редакция ${item.revision.fields.revision_label ?? "без обозначения"}`,
            }))}
            onChange={(value) => {
              set("predecessor", value);
              set("replacedLabels", []);
            }}
          />
          {!candidates.length ? (
            <p>
              Сначала сохраните карту предшествующей редакции с той же стадией,
              шифром, видом и областью работ.
            </p>
          ) : null}
          <div className="max-h-64 space-y-2 overflow-auto">
            {previousLabels.map((label) => (
              <Checkbox
                key={label}
                isSelected={draft.replacedLabels.includes(label)}
                isDisabled={disabled}
                onChange={(value) =>
                  set(
                    "replacedLabels",
                    value
                      ? [...draft.replacedLabels, label]
                      : draft.replacedLabels.filter((item) => item !== label),
                  )
                }
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Заменить лист {label}
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div>
          <Input
            label="Основание замены листов"
            value={draft.replacementBasis}
            maxLength={4000}
            isDisabled={disabled}
            onChange={(event) => set("replacementBasis", event.target.value)}
          />
        </div>
      ) : null}
      {!disabled && relation && draft.replacementAction !== "clear" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onPress={() => set("replacementAction", "clear")}
        >
          Снять частичную замену
        </Button>
      ) : null}
      {!disabled &&
      (draft.mapAction !== "unchanged" ||
        draft.replacementAction !== "unchanged") ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onPress={() =>
            form.setValue("sheets", initialSheetReview(revision), {
              shouldDirty: true,
            })
          }
        >
          Отменить изменения листов
        </Button>
      ) : null}
    </details>
  );
}
