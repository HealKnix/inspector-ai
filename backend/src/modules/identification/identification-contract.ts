import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { ClassificationResult } from "./classification-contract.js";

export const IDENTIFICATION_ENGINE_VERSION = "sheet-document-identification-v4";
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
  "observed_replaced_sheet",
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
  /** PAR routing and limitations at the exact immutable artifact locator. */
  parse_context?: {
    source: string;
    native_valid: boolean | null;
    include_in_main: boolean | null;
    region_id: string | null;
    region_kind: string | null;
    region_method: string | null;
    text_status: string | null;
    reasons: string[];
  };
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
  sheet_map?: SheetMap | null;
  sheet_replacement?: SheetReplacement | null;
}

/** Explicit inspector mapping, bound to one immutable PDF original. */
export interface SheetMap {
  file_id: string;
  source_sha256: string;
  sheets: { label: string; page_number: number }[];
  excluded_pages: number[];
  basis: string;
}
export interface SheetReplacement {
  predecessor_revision_id: string;
  replaced_labels: string[];
  basis: string;
}
export interface ResolvedSheet {
  label: string;
  page_number: number;
  document_id: string;
  revision_id: string;
  file_id: string;
  artifact_id: string;
  artifact_sha256: string;
  source_sha256: string;
}
export interface ResolvedSheetSet {
  selection_hash: string;
  sheets: ResolvedSheet[];
  chain: { revision_id: string; decision_hash: string }[];
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
  sheet_selection?: {
    reference: ResolvedSheetSet | null;
    actual: ResolvedSheetSet | null;
  };
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
  sheet_map?: SheetMap | null;
  sheet_replacement?: SheetReplacement | null;
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

function sheetLabel(value: unknown): asserts value is string {
  text(value, 80);
  if (
    value !== value.trim().normalize("NFC") ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new IdentificationContractError("identification_invalid_sheet_label");
}
export function validateSheetMap(value: unknown): SheetMap {
  const input = object(value, [
    "file_id",
    "source_sha256",
    "sheets",
    "excluded_pages",
    "basis",
  ]);
  uuid(input.file_id);
  if (
    typeof input.source_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.source_sha256)
  )
    throw new IdentificationContractError(
      "identification_invalid_sheet_source",
    );
  text(input.basis, 4000);
  if (
    !Array.isArray(input.sheets) ||
    !input.sheets.length ||
    input.sheets.length > 500 ||
    !Array.isArray(input.excluded_pages) ||
    input.excluded_pages.length > 500
  )
    throw new IdentificationContractError("identification_invalid_sheet_map");
  const pages = new Set<number>();
  const labels = new Set<string>();
  const pageNumbers: unknown[] = [...(input.excluded_pages as unknown[])];
  for (const item of input.sheets) {
    const sheet = object(item, ["label", "page_number"]);
    sheetLabel(sheet.label);
    if (labels.has(sheet.label))
      throw new IdentificationContractError(
        "identification_duplicate_sheet_label",
      );
    labels.add(sheet.label);
    pageNumbers.push(sheet.page_number);
  }
  for (const page of pageNumbers) {
    if (
      !Number.isSafeInteger(page) ||
      Number(page) < 1 ||
      Number(page) > 500 ||
      pages.has(Number(page))
    )
      throw new IdentificationContractError(
        "identification_invalid_sheet_page",
      );
    pages.add(Number(page));
  }
  return input as unknown as SheetMap;
}
export function validateSheetReplacement(value: unknown): SheetReplacement {
  const input = object(value, [
    "predecessor_revision_id",
    "replaced_labels",
    "basis",
  ]);
  uuid(input.predecessor_revision_id);
  text(input.basis, 4000);
  if (
    !Array.isArray(input.replaced_labels) ||
    !input.replaced_labels.length ||
    input.replaced_labels.length > 500
  )
    throw new IdentificationContractError(
      "identification_invalid_sheet_replacement",
    );
  for (const label of input.replaced_labels) sheetLabel(label);
  if (new Set(input.replaced_labels).size !== input.replaced_labels.length)
    throw new IdentificationContractError(
      "identification_duplicate_sheet_label",
    );
  return input as unknown as SheetReplacement;
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
        "sheet_map",
        "sheet_replacement",
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
      if (revision.sheet_map !== undefined && revision.sheet_map !== null)
        validateSheetMap(revision.sheet_map);
      if (
        revision.sheet_replacement !== undefined &&
        revision.sheet_replacement !== null
      )
        validateSheetReplacement(revision.sheet_replacement);
      if (
        revision.reference_revision_id !== undefined &&
        revision.reference_revision_id !== null
      )
        uuid(revision.reference_revision_id);
      if (
        revision.fields === undefined &&
        revision.approval === undefined &&
        revision.reference_revision_id === undefined &&
        revision.sheet_map === undefined &&
        revision.sheet_replacement === undefined
      )
        throw new IdentificationContractError(
          "identification_empty_clarification",
        );
    }
  }
  return input as unknown as ClarificationBatch;
}
