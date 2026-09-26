import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { ClassificationResult } from "./classification-contract.js";

export const IDENTIFICATION_ENGINE_VERSION = "whole-document-identification-v2";
export const IDENTIFICATION_FIELDS = [
  "stage",
  "kind_code",
  "title",
  "number",
  "date",
  "code",
  "scope",
  "works_from",
  "works_to",
  "revision_label",
  "reference_code",
  "observed_edition",
  "observed_status",
  "external_id",
] as const;
export type IdentificationField = (typeof IDENTIFICATION_FIELDS)[number];
export type IdentificationFields = Partial<Record<IdentificationField, string>>;

export interface IdentificationEvidence {
  file_id: string;
  artifact_id: string;
  artifact_sha256: string;
  source_sha256: string;
  page_number: number;
  block_id: string;
  quote: string;
  bbox: [number, number, number, number];
  structural_path: string | null;
}

export interface FieldCandidate {
  candidate_id: string;
  field: IdentificationField;
  raw: string;
  normalized: string | null;
  role: "own" | "reference" | "observed";
  method: "rules" | "classification" | "llm";
  engine_version: string;
  evidence: IdentificationEvidence[];
}

export interface DocumentRepresentation {
  file_id: string;
  artifact_id: string;
  artifact_sha256: string;
  source_sha256: string;
  format: string;
  page_count: number;
}

/** This is an inspector's confirmed interpretation, never an XML status. */
export interface RevisionApproval {
  confirmed: boolean;
  effective_from: string | null;
  effective_to: string | null;
  replaces_revision_id: string | null;
  basis: string | null;
}

export interface IdentificationRevision {
  revision_id: string;
  fields: IdentificationFields;
  candidates: FieldCandidate[];
  representations: DocumentRepresentation[];
  approval: RevisionApproval;
  blockers: string[];
  reference_revision_id?: string | null;
}

export interface IdentificationDocument {
  document_id: string;
  card_version: number;
  revisions: IdentificationRevision[];
}

export interface RevisionReference {
  document_id: string;
  revision_id: string;
}

export interface ComparisonContext {
  context_id: string;
  scope: string;
  works_period: { from: string | null; to: string | null };
  reference: RevisionReference | null;
  actual: RevisionReference;
  /** A technical evidence gate; it is not a ProcessStatus or a finding. */
  status: "READY" | "CLARIFICATION_REQUIRED";
  blockers: string[];
}

/** The service adds run_id, source fingerprint and the canonical snapshot hash. */
export interface IdentificationSnapshot {
  schema_version: 1;
  documents: IdentificationDocument[];
  contexts: ComparisonContext[];
  blockers: string[];
}

export interface IdentifyArtifactInput {
  representation: DocumentRepresentation;
  artifact: ParseArtifactData;
  classification?: ClassificationResult | null;
}
export type IdentifiedRevision = Omit<IdentificationRevision, "revision_id">;

export interface RevisionClarification {
  revision_id: string;
  fields?: Partial<Record<IdentificationField, string | null>>;
  approval?: RevisionApproval;
  reference_revision_id?: string | null;
}
export interface DocumentClarification {
  document_id: string;
  expected_version: number;
  revisions: RevisionClarification[];
}
export interface ClarificationBatch {
  request_id: string;
  expected_run_id: string;
  documents: DocumentClarification[];
  basis: string;
}

export class IdentificationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IdentificationContractError";
  }
}

export function isIdentificationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new IdentificationContractError("identification_invalid_request");
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new IdentificationContractError("identification_unknown_field");
  return value as Record<string, unknown>;
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new IdentificationContractError("identification_invalid_id");
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new IdentificationContractError("identification_invalid_text");
}

export function validateRevisionApproval(value: unknown): RevisionApproval {
  const input = object(value, [
    "confirmed",
    "effective_from",
    "effective_to",
    "replaces_revision_id",
    "basis",
  ]);
  if (typeof input.confirmed !== "boolean")
    throw new IdentificationContractError("identification_invalid_approval");
  for (const key of ["effective_from", "effective_to"] as const)
    if (input[key] !== null && !isIdentificationDate(input[key]))
      throw new IdentificationContractError("identification_invalid_period");
  if (
    typeof input.effective_from === "string" &&
    typeof input.effective_to === "string" &&
    input.effective_from > input.effective_to
  )
    throw new IdentificationContractError("identification_invalid_period");
  if (input.replaces_revision_id !== null) uuid(input.replaces_revision_id);
  if (input.basis !== null) text(input.basis, 4000);
  if (input.confirmed && !input.basis)
    throw new IdentificationContractError(
      "identification_approval_basis_required",
    );
  return input as unknown as RevisionApproval;
}

/** Reject unknown fields: client input cannot smuggle candidates or approval evidence. */
export function validateClarificationBatch(value: unknown): ClarificationBatch {
  const input = object(value, [
    "request_id",
    "expected_run_id",
    "documents",
    "basis",
  ]);
  uuid(input.request_id);
  uuid(input.expected_run_id);
  text(input.basis, 4000);
  if (
    !Array.isArray(input.documents) ||
    !input.documents.length ||
    input.documents.length > 200
  )
    throw new IdentificationContractError("identification_invalid_documents");
  const documentIds = new Set<string>();
  for (const item of input.documents) {
    const doc = object(item, ["document_id", "expected_version", "revisions"]);
    uuid(doc.document_id);
    if (documentIds.has(doc.document_id))
      throw new IdentificationContractError(
        "identification_duplicate_document",
      );
    documentIds.add(doc.document_id);
    if (
      !Number.isSafeInteger(doc.expected_version) ||
      Number(doc.expected_version) < 1
    )
      throw new IdentificationContractError("identification_invalid_version");
    if (
      !Array.isArray(doc.revisions) ||
      !doc.revisions.length ||
      doc.revisions.length > 200
    )
      throw new IdentificationContractError("identification_invalid_revisions");
    const revisionIds = new Set<string>();
    for (const itemRevision of doc.revisions) {
      const revision = object(itemRevision, [
        "revision_id",
        "fields",
        "approval",
        "reference_revision_id",
      ]);
      uuid(revision.revision_id);
      if (revisionIds.has(revision.revision_id))
        throw new IdentificationContractError(
          "identification_duplicate_revision",
        );
      revisionIds.add(revision.revision_id);
      if (revision.fields !== undefined) {
        const fields = object(revision.fields, IDENTIFICATION_FIELDS);
        for (const [key, field] of Object.entries(fields)) {
          if (field === null) continue;
          text(field, 2000);
          if (key === "stage" && !["PD", "RD", "ID"].includes(field))
            throw new IdentificationContractError(
              "identification_invalid_stage",
            );
          if (
            ["date", "works_from", "works_to"].includes(key) &&
            !isIdentificationDate(field)
          )
            throw new IdentificationContractError(
              "identification_invalid_date",
            );
        }
      }
      if (revision.approval !== undefined)
        validateRevisionApproval(revision.approval);
      if (
        revision.reference_revision_id !== undefined &&
        revision.reference_revision_id !== null
      )
        uuid(revision.reference_revision_id);
      if (
        revision.fields === undefined &&
        revision.approval === undefined &&
        revision.reference_revision_id === undefined
      )
        throw new IdentificationContractError(
          "identification_empty_clarification",
        );
    }
  }
  return input as unknown as ClarificationBatch;
}
