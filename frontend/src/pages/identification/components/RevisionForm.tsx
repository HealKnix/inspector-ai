import type { KindOptions } from "@/api/types/classification";
import type {
  IdentificationEvidence,
  IdentificationField,
  IdentificationRegistry,
  IdentificationRevision,
  RevisionClarification,
} from "@/api/types/identification";
import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { Input } from "@/components/input/Input";
import { Button } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  nextReviewQuestion,
  referenceOptions,
  reviewDocumentName,
  reviewFieldLabels,
  reviewFields,
  revisionContext,
} from "../lib/review-card";
import {
  confirmationBasis,
  reviewFormSchema,
  type ReviewFormValues,
} from "../lib/review-form";
import { ApprovalQuestion } from "./ApprovalQuestion";
import { ReviewFields } from "./ReviewFields";

export function RevisionForm({
  revision,
  registry,
  filenames,
  kindOptions,
  disabled,
  pending,
  onConfirm,
  onEvidence,
}: {
  revision: IdentificationRevision;
  registry: IdentificationRegistry;
  filenames: Map<string, string>;
  kindOptions: KindOptions | null;
  disabled: boolean;
  pending: boolean;
  onConfirm: (revision: RevisionClarification, basis: string) => void;
  onEvidence: (evidence: IdentificationEvidence | null) => void;
}) {
  const initialFields = reviewFields(revision);
  const editableFields = Object.keys(
    reviewFieldLabels,
  ) as IdentificationField[];
  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: {
      fields: Object.fromEntries(
        editableFields.map((field) => [field, revision.fields[field] ?? ""]),
      ),
      note: "",
      reference: revision.reference_revision_id ?? "",
      approvalChanged: false,
      confirmed: revision.approval.confirmed,
      effectiveFrom: revision.approval.effective_from ?? "",
      effectiveTo: revision.approval.effective_to ?? "",
      approvalBasis: revision.approval.basis ?? "",
      replaces: revision.approval.replaces_revision_id ?? "",
    },
  });
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty, dirtyFields },
  } = form;
  const stage = useWatch({ control, name: "fields.stage" });
  const kind = useWatch({ control, name: "fields.kind_code" });
  const reference = useWatch({ control, name: "reference" });
  const visibleFields = reviewFields({
    ...revision,
    fields: { ...revision.fields, stage, kind_code: kind },
  });
  if (initialFields.includes("stage") && !visibleFields.includes("stage"))
    visibleFields.unshift("stage");
  const extraFields = editableFields.filter(
    (field) => !visibleFields.includes(field),
  );
  const kinds =
    stage && kindOptions
      ? (kindOptions[stage as keyof KindOptions] ?? []).map((item) => ({
          id: item.code,
          label: item.title,
        }))
      : [];
  const question = nextReviewQuestion(registry, revision);
  const context = revisionContext(registry, revision);
  const referenceDocument = registry.documents.find(
    (item) => item.document_id === context?.reference?.document_id,
  );
  const referenceRevision = referenceDocument?.revisions.find(
    (item) => item.revision_id === context?.reference?.revision_id,
  );
  const replacementDocument = registry.documents.find((item) =>
    item.revisions.some(
      (candidate) =>
        candidate.revision_id === revision.approval.replaces_revision_id,
    ),
  );
  const replacementRevision = replacementDocument?.revisions.find(
    (item) => item.revision_id === revision.approval.replaces_revision_id,
  );
  const replacementOptions = registry.documents.flatMap((document) =>
    document.revisions
      .filter(
        (candidate) =>
          candidate.revision_id !== revision.revision_id &&
          candidate.fields.stage === revision.fields.stage &&
          candidate.fields.code === revision.fields.code &&
          candidate.fields.scope === revision.fields.scope &&
          !candidate.blockers.some((reason) =>
            reason.startsWith("unsupported_"),
          ),
      )
      .map((candidate) => ({
        id: candidate.revision_id,
        label: `${reviewDocumentName(document, filenames, candidate)} · редакция ${candidate.fields.revision_label ?? "без обозначения"}`,
      })),
  );
  const locked = disabled || pending;
  const approvalControl = (
    <ApprovalQuestion
      form={form}
      disabled={locked}
      replacementOptions={replacementOptions}
      replacementName={
        replacementDocument && replacementRevision
          ? reviewDocumentName(
              replacementDocument,
              filenames,
              replacementRevision,
            )
          : revision.approval.replaces_revision_id
            ? "ранее выбранная редакция"
            : undefined
      }
    />
  );
  const submit = handleSubmit((values) => {
    if (locked) return;
    if (
      values.fields.stage !== (revision.fields.stage ?? "") &&
      values.fields.kind_code &&
      !kinds.some((item) => item.id === values.fields.kind_code)
    ) {
      setError("root", {
        message:
          "Выберите соответствующий стадии вид документа или оставьте его пустым.",
      });
      return;
    }
    // Main fields are explicitly confirmed. Advanced fields are sent only when
    // edited; never turn unopened metadata or empty fields into human evidence.
    const reviewedFields = [
      ...visibleFields,
      ...extraFields.filter((field) => dirtyFields.fields?.[field]),
    ];
    const fields = Object.fromEntries(
      reviewedFields
        .filter(
          (field) =>
            Boolean(values.fields[field]?.trim() || revision.fields[field]) &&
            (field !== "kind_code" ||
              !values.fields[field] ||
              kinds.some((item) => item.id === values.fields[field])),
        )
        .map((field) => [field, values.fields[field]?.trim() || null]),
    );
    const approvalChanged = values.approvalChanged;
    const referenceChanged =
      values.reference !== (revision.reference_revision_id ?? "");
    if (!Object.keys(fields).length && !approvalChanged && !referenceChanged) {
      setError("root", {
        message: "Укажите реквизиты, которые удалось сверить с документом.",
      });
      return;
    }
    onConfirm(
      {
        revision_id: revision.revision_id,
        ...(Object.keys(fields).length ? { fields } : {}),
        ...(approvalChanged
          ? {
              approval: {
                confirmed: values.confirmed,
                effective_from: values.effectiveFrom || null,
                effective_to: values.effectiveTo || null,
                replaces_revision_id: values.replaces || null,
                basis: values.approvalBasis.trim() || null,
              },
            }
          : {}),
        ...(referenceChanged
          ? { reference_revision_id: values.reference || null }
          : {}),
      },
      `${confirmationBasis}${values.note.trim() ? ` ${values.note.trim()}` : ""}`,
    );
  });
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4"
      aria-label="Проверка реквизитов"
    >
      <ReviewFields
        fields={visibleFields}
        form={form}
        revision={revision}
        stage={stage}
        kinds={kinds}
        disabled={locked}
        onEvidence={onEvidence}
      />
      {stage !== "PD" ? (
        <div className="text-sm">
          <p className="text-copy-muted">Документ для сравнения</p>
          <p>
            {referenceDocument && referenceRevision
              ? reviewDocumentName(
                  referenceDocument,
                  filenames,
                  referenceRevision,
                )
              : revision.fields.reference_code
                ? `${revision.fields.reference_code} · система подберёт подходящую редакцию`
                : "Система подберёт по месту и периоду работ"}
          </p>
        </div>
      ) : null}
      {question ? (
        <aside
          className="border-warning/40 bg-warning/5 space-y-3 rounded-xl border p-3 text-sm"
          aria-label="Следующий шаг"
        >
          <p>{question.text}</p>
          {question.kind === "reference" ? (
            <Controller
              control={control}
              name="reference"
              render={({ field }) => (
                <IdentificationSelect
                  label="Редакция для этих работ"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={locked}
                  options={referenceOptions(registry, revision, filenames)}
                />
              )}
            />
          ) : null}
          {question.kind === "approval" ? approvalControl : null}
        </aside>
      ) : null}
      <details className="text-sm">
        <summary className="text-copy-muted cursor-pointer">
          Другие реквизиты и решения
        </summary>
        <div className="space-y-4 pt-3">
          <ReviewFields
            fields={extraFields}
            form={form}
            revision={revision}
            stage={stage}
            kinds={kinds}
            disabled={locked}
            onEvidence={onEvidence}
          />
          {question?.kind !== "approval" && question?.kind !== "restriction"
            ? approvalControl
            : null}
          {revision.reference_revision_id ? (
            <div className="space-y-2">
              <p>Редакция для сравнения была выбрана вручную.</p>
              {reference ? (
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={locked}
                  onPress={() =>
                    form.setValue("reference", "", { shouldDirty: true })
                  }
                >
                  Подобрать связь автоматически
                </Button>
              ) : (
                <p>После сохранения система заново подберёт связь.</p>
              )}
            </div>
          ) : null}
        </div>
      </details>
      {!disabled ? (
        <>
          <details className="text-sm">
            <summary className="text-copy-muted cursor-pointer">
              Добавить пояснение
            </summary>
            <Controller
              control={control}
              name="note"
              render={({ field }) => (
                <Input
                  {...field}
                  className="mt-3"
                  value={field.value}
                  onChange={field.onChange}
                  label="Пояснение к проверке"
                  isDisabled={pending}
                  errorMessage={errors.note?.message}
                />
              )}
            />
          </details>
          <p className="text-copy-muted text-xs">
            {confirmationBasis} Результаты проверки обновятся; предыдущие
            сохранятся.
          </p>
          <Button type="submit" className="w-full" isDisabled={pending}>
            {pending
              ? "Сохраняем…"
              : isDirty
                ? "Сохранить и проверить"
                : "Подтвердить и проверить"}
          </Button>
        </>
      ) : null}
      {errors.root ? (
        <p role="alert" className="text-danger text-sm">
          {errors.root.message}
        </p>
      ) : null}
    </form>
  );
}
