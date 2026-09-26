import { ApiError } from "@/api/errors";
import { useKindOptions } from "@/api/hooks/use-classification";
import {
  identificationErrorMessage,
  useApplyIdentification,
} from "@/api/hooks/use-identification";
import type {
  ClarificationBatch,
  IdentificationDocument,
  IdentificationEvidence,
  IdentificationRegistry,
  IdentificationRevision,
  RevisionClarification,
} from "@/api/types/identification";
import { Button } from "@heroui/react";
import { useRef, useState } from "react";
import { identificationCanApply } from "../lib/identification";
import { reviewDocumentName, reviewFields } from "../lib/review-card";
import { FieldCandidates } from "./FieldCandidates";
import { IdentificationHistory } from "./IdentificationHistory";
import { OriginalDocumentView } from "./OriginalDocumentView";
import { RevisionForm } from "./RevisionForm";

export function DocumentReview({
  objectId,
  registry,
  document,
  revision,
  filenames,
  unavailable,
  onReload,
  onApplied,
}: {
  objectId: string;
  registry: IdentificationRegistry;
  document: IdentificationDocument;
  revision: IdentificationRevision;
  filenames: Map<string, string>;
  unavailable: boolean;
  onReload: () => Promise<void>;
  onApplied: (result: {
    run_id: string;
    resolved_input_hash: string | null;
  }) => void;
}) {
  // Keep the reviewed snapshot and local form on failed requests/background refresh.
  const [reviewed] = useState({ registry, document, revision });
  const [evidence, setEvidence] = useState<IdentificationEvidence | null>(
    () =>
      revision.candidates.find(
        (candidate) =>
          candidate.role === "own" &&
          reviewFields(revision).includes(candidate.field) &&
          candidate.normalized === revision.fields[candidate.field],
      )?.evidence[0] ?? null,
  );
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [retryBody, setRetryBody] = useState<ClarificationBatch | null>(null);
  const attempt = useRef<{
    signature: string;
    body: ClarificationBatch;
  } | null>(null);
  const kinds = useKindOptions(objectId);
  const apply = useApplyIdentification(objectId, registry.process_id);
  const stale =
    document.card_version !== reviewed.document.card_version ||
    registry.resolved_input_hash !== reviewed.registry.resolved_input_hash ||
    registry.run_id !== reviewed.registry.run_id;
  const disabled =
    unavailable || conflict || stale || !identificationCanApply(registry);
  const send = async (body: ClarificationBatch) => {
    setError(null);
    setRetryBody(null);
    try {
      onApplied(await apply.mutateAsync(body));
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.status === 409)
        setConflict(true);
      else if (
        !(failure instanceof ApiError) ||
        failure.status === null ||
        (failure.status ?? 0) >= 500
      )
        setRetryBody(body);
    }
  };
  const confirm = (patch: RevisionClarification, basis: string) => {
    if (disabled || apply.isPending) return;
    const input = {
      expected_run_id: reviewed.registry.run_id,
      documents: [
        {
          document_id: reviewed.document.document_id,
          expected_version: reviewed.document.card_version,
          revisions: [patch],
        },
      ],
      basis,
    };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        body: { ...input, request_id: crypto.randomUUID() },
      };
    void send(attempt.current.body);
  };
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <OriginalDocumentView
        key={`${reviewed.revision.revision_id}:${evidence?.artifact_id ?? "original"}:${evidence?.block_id ?? ""}:${evidence?.page_number ?? ""}`}
        objectId={objectId}
        processId={reviewed.registry.process_id}
        runId={reviewed.registry.run_id}
        revision={reviewed.revision}
        filenames={filenames}
        evidence={evidence}
      />
      <section
        className="border-border bg-card min-w-0 space-y-4 rounded-xl border p-4"
        aria-label="Карточка документа"
      >
        <h2 className="text-lg font-semibold">
          {reviewDocumentName(reviewed.document, filenames, reviewed.revision)}
        </h2>
        <RevisionForm
          revision={reviewed.revision}
          registry={reviewed.registry}
          filenames={filenames}
          kindOptions={kinds.data?.options ?? null}
          disabled={disabled}
          pending={apply.isPending}
          onConfirm={confirm}
          onEvidence={setEvidence}
        />
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {identificationErrorMessage(error)}
          </p>
        ) : null}
        {stale && !conflict ? (
          <p role="status" className="text-warning text-sm">
            Карточка обновилась. Введённые значения сохранены на экране;
            откройте актуальные сведения перед подтверждением.
          </p>
        ) : null}
        {retryBody ? (
          <Button
            variant="outline"
            isDisabled={apply.isPending}
            onPress={() => void send(retryBody)}
          >
            Повторить отправку
          </Button>
        ) : null}
        {conflict || stale || unavailable ? (
          <Button
            variant="outline"
            isDisabled={apply.isPending}
            onPress={() => void onReload()}
          >
            Обновить карточку
          </Button>
        ) : null}
        <details className="border-border border-t pt-3 text-sm">
          <summary className="text-copy-muted cursor-pointer">
            История и источники
          </summary>
          <div className="space-y-4 pt-4">
            <FieldCandidates
              revision={reviewed.revision}
              onEvidence={setEvidence}
            />
            <IdentificationHistory
              objectId={objectId}
              processId={reviewed.registry.process_id}
              runId={reviewed.registry.run_id}
              documentId={reviewed.document.document_id}
              resolvedInputHash={
                reviewed.registry.resolved_input_hash ?? undefined
              }
            />
          </div>
        </details>
      </section>
    </div>
  );
}
