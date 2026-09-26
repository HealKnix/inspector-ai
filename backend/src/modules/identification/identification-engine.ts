import { createHash } from "node:crypto";
import type { ParseBlock } from "../parsing/parsing-contract.js";
import { classifyByRules } from "./classification-rules.js";
import {
  IDENTIFICATION_ENGINE_VERSION,
  IdentificationContractError,
  isIdentificationDate,
  type ComparisonContext,
  type DocumentRepresentation,
  type FieldCandidate,
  type IdentificationDocument,
  type IdentificationEvidence,
  type IdentificationField,
  type IdentificationRevision,
  type IdentificationSnapshot,
  type IdentifiedRevision,
  type IdentifyArtifactInput,
  type RevisionApproval,
  type RevisionReference,
} from "./identification-contract.js";

const A = "http://idActs/AOSR.xsd";
const C = "http://types/CommonTypes.xsd";
const B = "http://types/BaseDocument.xsd";
const S = "http://idCommon/AsBuiltSchemaDoc.xsd";
const q = (namespace: string, name: string) => `/{${namespace}}${name}[]`;
const aosrRoot = q(A, "aosr");
const aosrInfo = aosrRoot + q(A, "actInfo");
const schemaRoot = q(S, "asBuiltSchemaDoc");
const schemaInfo = schemaRoot + q(S, "asBuiltSchemaDocInfo");
const ownInfo = aosrInfo + q(C, "documentInfo");
const aosrWorkLocation =
  aosrInfo +
  q(A, "worksList") +
  q(A, "worksListItem") +
  q(A, "location") +
  q(C, "place");
const textPath = (path: string) => path + "/text()[]";
const compactPath = (path: string) => path.replace(/\[\d+\]/g, "[]");
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Deliberately no transliteration or guessed equivalence of codes/axis labels. */
export function normalizeIdentificationText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}
const key = (value: string | undefined) =>
  normalizeIdentificationText(value ?? "").toLocaleLowerCase("ru-RU");
function normalized(field: IdentificationField, raw: string): string | null {
  const value = normalizeIdentificationText(raw);
  if (!value) return null;
  if (["date", "works_from", "works_to"].includes(field)) {
    const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
    const date = dotted ? `${dotted[3]}-${dotted[2]}-${dotted[1]}` : value;
    return isIdentificationDate(date) ? date : null;
  }
  return value;
}

export function emptyRevisionApproval(): RevisionApproval {
  return {
    confirmed: false,
    effective_from: null,
    effective_to: null,
    replaces_revision_id: null,
    basis: null,
  };
}

function evidenceFor(
  representation: DocumentRepresentation,
  page: number,
  block: ParseBlock,
): IdentificationEvidence {
  return {
    file_id: representation.file_id,
    artifact_id: representation.artifact_id,
    artifact_sha256: representation.artifact_sha256,
    source_sha256: representation.source_sha256,
    page_number: page,
    block_id: block.id,
    quote: block.raw_text || block.normalized_text,
    bbox: [...block.bbox],
    structural_path: block.structural_path,
  };
}

/** No network, filenames, folders or upload timestamps participate in identification. */
export function identifyArtifact(
  input: IdentifyArtifactInput,
): IdentifiedRevision {
  const { artifact, representation, classification } = input;
  if (
    artifact.source_sha256 !== representation.source_sha256 ||
    artifact.pages.length !== representation.page_count
  )
    throw new IdentificationContractError("identification_artifact_mismatch");
  const candidates: FieldCandidate[] = [];
  const accepted = new Set<string>();
  const blockers = new Set<string>();
  const add = (
    field: IdentificationField,
    raw: string,
    evidence: IdentificationEvidence[],
    role: FieldCandidate["role"] = "own",
    method: FieldCandidate["method"] = "rules",
    reliable = true,
  ) => {
    const candidate: FieldCandidate = {
      candidate_id: hash([
        representation.artifact_id,
        field,
        raw,
        role,
        method,
        evidence.map((item) => [
          item.page_number,
          item.block_id,
          item.structural_path,
        ]),
      ]),
      field,
      raw,
      normalized: normalized(field, raw),
      role,
      method,
      engine_version: IDENTIFICATION_ENGINE_VERSION,
      evidence,
    };
    if (
      !candidates.some((item) => item.candidate_id === candidate.candidate_id)
    )
      candidates.push(candidate);
    if (reliable && method !== "llm" && candidate.normalized !== null)
      accepted.add(candidate.candidate_id);
  };
  if (artifact.coverage.unreadable_pages > 0 || artifact.quality === "ABSTAIN")
    blockers.add("source_unreadable");
  const format = representation.format.toUpperCase();
  if (!["XML", "PDF", "DOCX"].includes(format))
    blockers.add("unsupported_format");

  if (format === "XML") {
    let knownSchema = false;
    for (const page of artifact.pages)
      for (const block of page.blocks) {
        const rawPath = block.structural_path;
        if (!rawPath) continue;
        const path = compactPath(rawPath);
        if (
          path.startsWith(aosrRoot + "/") ||
          path.startsWith(schemaRoot + "/")
        )
          knownSchema = true;
        const value = block.raw_text || block.normalized_text;
        const evidence = [evidenceFor(representation, page.page_number, block)];
        const aosrFields: Record<string, IdentificationField> = {
          name: "title",
          number: "number",
          date: "date",
          docId: "external_id",
        };
        const schemeFields: Record<string, IdentificationField> = {
          docName: "title",
          docCode: "code",
          docDate: "date",
          docId: "external_id",
        };
        for (const [name, field] of Object.entries(aosrFields)) {
          if (path === textPath(ownInfo + q(C, name))) {
            add(field, value, evidence);
            if (
              name === "name" &&
              /^акт освидетельствования скрытых работ$/i.test(value.trim())
            ) {
              add("stage", "ID", evidence);
              add("kind_code", "AOSR", evidence);
            }
          }
        }
        for (const [name, field] of Object.entries(schemeFields))
          if (path === textPath(schemaInfo + q(S, name)))
            add(field, value, evidence);
        if (
          path === textPath(schemaInfo + q(S, "docType")) &&
          value.trim() === "ИС"
        )
          add("stage", "ID", evidence);
        // BaseDocument edition and documentInfo edition have different meanings.
        if (
          [
            textPath(aosrRoot + q(B, "edition")),
            textPath(schemaRoot + q(B, "edition")),
            textPath(ownInfo + q(C, "edition")),
          ].includes(path)
        )
          add("observed_edition", value, evidence, "observed");
        if (
          [
            textPath(
              aosrRoot +
                q(A, "actsServiceAttributes") +
                q(C, "status") +
                q(C, "docStatus"),
            ),
            textPath(
              schemaRoot +
                q(S, "docServiceAttributes") +
                q(C, "status") +
                q(C, "docStatus"),
            ),
          ].includes(path)
        )
          add("observed_status", value, evidence, "observed");
        for (const [name, field] of [
          ["beginDate", "works_from"],
          ["endDate", "works_to"],
        ] as const)
          if (path === textPath(aosrInfo + q(A, "worksDate") + q(C, name)))
            add(field, value, evidence);
        // Each own work location keeps its exact indexed locator. Different
        // locations are separate candidates and resolve to a scope conflict,
        // never a guessed combined area or a first-item winner.
        if (path === textPath(aosrWorkLocation)) add("scope", value, evidence);
        const section =
          q(C, "obligatoryWorkDocumentation") +
          q(C, "workDocumentationSectionsList") +
          q(C, "workDocumentationSectionsListItem") +
          q(C, "workDocumentationSectionCode");
        const actReference =
          aosrInfo +
          q(A, "workAndProjectDocumentationsList") +
          q(A, "workAndProjectDocumentationsListItem") +
          q(A, "workAndProjectDocumentation") +
          section;
        const schemaReference =
          schemaRoot +
          q(S, "workAndProjectDocsList") +
          q(S, "workAndProjectDocsListItem") +
          q(S, "workAndProjectDocsSections") +
          section;
        if (
          path === textPath(actReference) ||
          path === textPath(schemaReference)
        )
          add("reference_code", value, evidence, "reference");
        // Attachment metadata stays visible as reference evidence and cannot replace own fields.
        if (
          path.startsWith(aosrInfo + q(A, "attachmentsList") + "/") &&
          /\/(?:\{[^}]+\})(?:name|number|date)\[\]\/text\(\)\[\]$/.test(path)
        ) {
          const field: IdentificationField = path.includes("}number[]")
            ? "number"
            : path.includes("}date[]")
              ? "date"
              : "title";
          add(field, value, evidence, "reference", "rules", false);
        }
      }
    if (!knownSchema) blockers.add("unsupported_xml_schema");
  } else if (["PDF", "DOCX"].includes(format)) {
    const ruleCandidates = classifyByRules(artifact, format);
    const families = new Set(ruleCandidates.map((item) => item.stage));
    const kinds = new Set(
      ruleCandidates.map((item) => item.document_kind).filter(Boolean),
    );
    if (families.size > 1 || kinds.size > 1)
      blockers.add("unsupported_mixed_document");
    for (const item of ruleCandidates) {
      const evidence = item.evidence.flatMap((locator) => {
        const page = artifact.pages.find(
          (candidate) => candidate.page_number === locator.page_number,
        );
        const block = page?.blocks.find(
          (candidate) => candidate.id === locator.block_id,
        );
        return page && block
          ? [evidenceFor(representation, page.page_number, block)]
          : [];
      });
      if (!evidence.length) continue;
      const reliable = evidence.every(
        (locator) =>
          artifact.pages
            .find((page) => page.page_number === locator.page_number)
            ?.blocks.find((block) => block.id === locator.block_id)?.source !==
          "ocr",
      );
      add("stage", item.stage, evidence, "own", "rules", reliable);
      if (item.document_kind)
        add("title", item.document_kind, evidence, "own", "rules", reliable);
    }
    for (const page of artifact.pages)
      for (const [index, block] of page.blocks.entries()) {
        if (block.include_in_main === false) continue;
        const text = normalizeIdentificationText(
          block.raw_text || block.normalized_text,
        );
        const evidence = [evidenceFor(representation, page.page_number, block)];
        if (
          /замен[аыя]\s+(?:отдельных\s+)?листов|частичная\s+замена|лист\s+\S+\s+взамен\s+листа/i.test(
            text,
          )
        )
          blockers.add("unsupported_partial_replacement");
        const prefix = page.blocks
          .slice(Math.max(0, index - 2), index)
          .map((item) => item.raw_text || item.normalized_text)
          .join(" ");
        if (/приложени[яе]|перечень|ссылочн|содержание|ведомость/i.test(prefix))
          continue;
        if (!(index < 16 || (block.bbox[0] >= 0.4 && block.bbox[1] >= 0.55)))
          continue;
        if (text.length > 600) continue;
        const reliable = block.source !== "ocr";
        const addMatch = (
          field: IdentificationField,
          match: RegExpExecArray | null,
          role: FieldCandidate["role"] = "own",
        ) => {
          if (match?.[1])
            add(field, match[1], evidence, role, "rules", reliable);
        };
        addMatch(
          "number",
          /^(?:акт(?:\s+освидетельствования\s+скрытых\s+работ)?|АОСР)\s*№\s*([^\s,;]+)(?:\s|$)/iu.exec(
            text,
          ),
        );
        addMatch(
          "date",
          /^(?:акт|АОСР)[^\n]*?\sот\s+(\d{2}\.\d{2}\.\d{4})(?:\s|$)/iu.exec(
            text,
          ),
        );
        addMatch(
          "date",
          /^(?:дата документа|дата составления)\s*[:：]\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/iu.exec(
            text,
          ),
        );
        addMatch(
          "code",
          /^(?:шифр(?: документа)?|обозначение документа)\s*[:：]\s*(\S.{0,159})$/iu.exec(
            text,
          ),
        );
        addMatch(
          "revision_label",
          /^(?:редакция|ревизия|номер изменения)\s*[:：]\s*(\S.{0,79})$/iu.exec(
            text,
          ),
        );
        addMatch(
          "scope",
          /^(?:область работ|область применения)\s*[:：]\s*(\S.{0,299})$/iu.exec(
            text,
          ),
        );
        addMatch(
          "reference_code",
          /^шифр (?:проектной|рабочей) документации\s*[:：]\s*(\S.{0,159})$/iu.exec(
            text,
          ),
          "reference",
        );
        const period =
          /^период работ\s*[:：]\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\s*(?:—|–|по|до)\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/iu.exec(
            text,
          );
        if (period) {
          add("works_from", period[1]!, evidence, "own", "rules", reliable);
          add("works_to", period[2]!, evidence, "own", "rules", reliable);
        }
      }
  }

  if (classification) {
    const evidence = classification.evidence.flatMap((locator) => {
      const page = artifact.pages.find(
        (item) => item.page_number === locator.page_number,
      );
      const block = page?.blocks.find((item) => item.id === locator.block_id);
      return page &&
        block &&
        (block.raw_text || block.normalized_text).includes(locator.quote)
        ? [evidenceFor(representation, page.page_number, block)]
        : [];
    });
    // Legacy manual decisions are persisted by the service separately. Empty
    // evidence or an LLM suggestion never becomes automatic authority here.
    const method = classification.method === "llm" ? "llm" : "classification";
    const reliable =
      classification.method === "rules" &&
      !classification.needs_review &&
      evidence.length > 0;
    if (evidence.length) {
      if (classification.stage)
        add("stage", classification.stage, evidence, "own", method, reliable);
      if (classification.kind_code)
        add(
          "kind_code",
          classification.kind_code,
          evidence,
          "own",
          method,
          reliable,
        );
      if (classification.document_kind)
        add(
          "title",
          classification.document_kind,
          evidence,
          "own",
          method,
          reliable,
        );
    }
    if (classification.reasons.includes("possible_mixed_document"))
      blockers.add("unsupported_mixed_document");
  }

  const fields: IdentifiedRevision["fields"] = {};
  for (const field of new Set(candidates.map((item) => item.field))) {
    const eligible = candidates.filter(
      (item) =>
        item.field === field &&
        accepted.has(item.candidate_id) &&
        (item.role !== "reference" || field === "reference_code"),
    );
    const values = [...new Set(eligible.map((item) => item.normalized!))];
    if (values.length === 1) fields[field] = values[0];
    else if (values.length > 1 && !field.startsWith("observed_")) {
      blockers.add(`field_conflict:${field}`);
      if (field === "number" && format !== "XML")
        blockers.add("unsupported_mixed_document");
    }
  }
  return {
    fields,
    candidates: candidates.sort((a, b) =>
      a.candidate_id.localeCompare(b.candidate_id),
    ),
    representations: [{ ...representation }],
    approval: emptyRevisionApproval(),
    blockers: [...blockers].sort(),
    reference_revision_id: null,
  };
}

type RevisionData = IdentificationRevision | IdentifiedRevision;
const identityFields = (
  stage: string | undefined,
): IdentificationField[] | null =>
  stage === "ID"
    ? [
        "stage",
        "kind_code",
        "number",
        "date",
        "scope",
        "works_from",
        "works_to",
      ]
    : stage === "PD" || stage === "RD"
      ? [
          "stage",
          "kind_code",
          "code",
          "date",
          "scope",
          "works_from",
          "works_to",
        ]
      : null;

/** Strict identity is intentionally an abstaining gate, not a fuzzy merge score. */
export function canMergeRepresentations(
  left: RevisionData,
  right: RevisionData,
): boolean {
  const required = identityFields(left.fields.stage);
  if (!required || left.fields.stage !== right.fields.stage) return false;
  if (
    [...left.blockers, ...right.blockers].some(
      (item) =>
        item.startsWith("unsupported_") ||
        item.startsWith("field_conflict:") ||
        item === "source_unreadable",
    )
  )
    return false;
  if (
    required.some(
      (field) =>
        !key(left.fields[field]) ||
        !key(right.fields[field]) ||
        key(left.fields[field]) !== key(right.fields[field]),
    )
  )
    return false;
  // Even non-key own metadata is significant: absent or conflicting populated
  // values do not silently collapse PDF/XML into a single revision.
  const fields = new Set([
    ...Object.keys(left.fields),
    ...Object.keys(right.fields),
  ] as IdentificationField[]);
  for (const field of fields) {
    if (field.startsWith("observed_")) continue;
    // XML external IDs need not be printed in the PDF representation. They
    // remain conflict evidence when both representations actually supply one.
    if (
      field === "external_id" &&
      (!left.fields.external_id || !right.fields.external_id)
    )
      continue;
    if (key(left.fields[field]) !== key(right.fields[field])) return false;
  }
  const leftFormats = new Set(
    left.representations.map((item) => item.format.toUpperCase()),
  );
  const rightFormats = new Set(
    right.representations.map((item) => item.format.toUpperCase()),
  );
  return (
    (leftFormats.has("PDF") && rightFormats.has("XML")) ||
    (leftFormats.has("XML") && rightFormats.has("PDF"))
  );
}

/** Stable first revision wins only after strict metadata equality; no IDs are invented. */
export function mergeIdenticalRepresentations(
  revisions: IdentificationRevision[],
): IdentificationRevision[] {
  const result: IdentificationRevision[] = [];
  for (const revision of [...revisions].sort((a, b) =>
    a.revision_id.localeCompare(b.revision_id),
  )) {
    const found = result.find((existing) =>
      canMergeRepresentations(existing, revision),
    );
    if (!found) {
      result.push(structuredClone(revision));
      continue;
    }
    const representations = new Map(
      [...found.representations, ...revision.representations].map((item) => [
        `${item.file_id}:${item.artifact_id}`,
        item,
      ]),
    );
    found.representations = [...representations.values()].sort((a, b) =>
      a.artifact_id.localeCompare(b.artifact_id),
    );
    const candidates = new Map(
      [...found.candidates, ...revision.candidates].map((item) => [
        item.candidate_id,
        item,
      ]),
    );
    found.candidates = [...candidates.values()].sort((a, b) =>
      a.candidate_id.localeCompare(b.candidate_id),
    );
  }
  return result;
}

interface LocatedRevision {
  document: IdentificationDocument;
  revision: IdentificationRevision;
}
function reference(item: LocatedRevision): RevisionReference {
  return {
    document_id: item.document.document_id,
    revision_id: item.revision.revision_id,
  };
}

function structuralBlockers(revision: IdentificationRevision): string[] {
  return revision.blockers.filter((blocker) => {
    if (blocker.startsWith("field_conflict:"))
      return !revision.fields[
        blocker.slice("field_conflict:".length) as IdentificationField
      ];
    return (
      blocker.startsWith("unsupported_") ||
      blocker === "source_unreadable" ||
      blocker === "source_integrity_mismatch"
    );
  });
}
function approved(revision: IdentificationRevision): boolean {
  return (
    revision.approval.confirmed && Boolean(revision.approval.basis?.trim())
  );
}
function validApprovalPeriod(revision: IdentificationRevision): boolean {
  const { effective_from: from, effective_to: to } = revision.approval;
  return (
    isIdentificationDate(from) &&
    (to === null || (isIdentificationDate(to) && from <= to))
  );
}
function covers(
  revision: IdentificationRevision,
  from: string,
  to: string,
): boolean {
  return (
    validApprovalPeriod(revision) &&
    revision.approval.effective_from! <= from &&
    (revision.approval.effective_to === null ||
      revision.approval.effective_to >= to)
  );
}

function replacementErrors(items: LocatedRevision[]): Map<string, string[]> {
  const byId = new Map(items.map((item) => [item.revision.revision_id, item]));
  const errors = new Map<string, string[]>();
  for (const item of items) {
    const seen = new Set([item.revision.revision_id]);
    let current: LocatedRevision | undefined = item;
    while (current?.revision.approval.replaces_revision_id) {
      const predecessorId: string =
        current.revision.approval.replaces_revision_id;
      if (seen.has(predecessorId)) {
        errors.set(item.revision.revision_id, ["replacement_cycle"]);
        break;
      }
      seen.add(predecessorId);
      const predecessor = byId.get(predecessorId);
      if (
        !predecessor ||
        predecessor.document.document_id !== item.document.document_id ||
        key(predecessor.revision.fields.scope) !==
          key(item.revision.fields.scope) ||
        predecessor.revision.fields.stage !== item.revision.fields.stage
      ) {
        errors.set(item.revision.revision_id, ["replacement_target_invalid"]);
        break;
      }
      if (
        !approved(current.revision) ||
        !validApprovalPeriod(current.revision)
      ) {
        errors.set(item.revision.revision_id, ["replacement_unconfirmed"]);
        break;
      }
      if (
        predecessor.revision.approval.effective_from &&
        current.revision.approval.effective_from! <
          predecessor.revision.approval.effective_from
      ) {
        errors.set(item.revision.revision_id, ["replacement_period_invalid"]);
        break;
      }
      current = predecessor;
    }
  }
  return errors;
}

/** Evaluate only the documents inside one object-scoped immutable selection. */
export function buildSelectionSnapshot(
  input: IdentificationDocument[],
): IdentificationSnapshot {
  const documents = structuredClone(input).sort((a, b) =>
    a.document_id.localeCompare(b.document_id),
  );
  const documentIds = new Set<string>();
  const revisionIds = new Set<string>();
  for (const document of documents) {
    if (documentIds.has(document.document_id))
      throw new IdentificationContractError(
        "identification_duplicate_document",
      );
    documentIds.add(document.document_id);
    document.revisions.sort((a, b) =>
      a.revision_id.localeCompare(b.revision_id),
    );
    for (const revision of document.revisions) {
      if (revisionIds.has(revision.revision_id))
        throw new IdentificationContractError(
          "identification_duplicate_revision",
        );
      revisionIds.add(revision.revision_id);
      revision.representations.sort((a, b) =>
        a.artifact_id.localeCompare(b.artifact_id),
      );
      revision.candidates.sort((a, b) =>
        a.candidate_id.localeCompare(b.candidate_id),
      );
      revision.blockers = [...new Set(revision.blockers)].sort();
    }
  }
  const all = documents.flatMap((document) =>
    document.revisions.map((revision) => ({ document, revision })),
  );
  const byId = new Map(all.map((item) => [item.revision.revision_id, item]));
  const replacementProblems = replacementErrors(all);
  const contexts: ComparisonContext[] = [];
  const snapshotBlockers = new Set<string>();
  for (const actual of all) {
    const revision = actual.revision;
    const stage = revision.fields.stage;
    if (stage === "PD") {
      for (const blocker of [
        ...structuralBlockers(revision),
        ...(replacementProblems.get(revision.revision_id) ?? []),
      ])
        snapshotBlockers.add(blocker);
      continue;
    }
    const blockers = new Set([
      ...structuralBlockers(revision),
      ...(replacementProblems.get(revision.revision_id) ?? []),
    ]);
    if (stage !== "RD" && stage !== "ID") blockers.add("stage_unresolved");
    const scope = normalizeIdentificationText(revision.fields.scope ?? "");
    if (!scope) blockers.add("scope_unresolved");
    if (!approved(revision)) blockers.add("actual_approval_unconfirmed");
    const from = revision.fields.works_from ?? null;
    const to = revision.fields.works_to ?? null;
    // Dates are never inferred from upload order, document issue date or Signed.
    if (!isIdentificationDate(from) || !isIdentificationDate(to) || from > to)
      blockers.add("works_period_unresolved");
    let selected: LocatedRevision | null = null;
    let pool: LocatedRevision[] = [];
    if (revision.reference_revision_id) {
      const explicit = byId.get(revision.reference_revision_id);
      if (!explicit || explicit.revision.revision_id === revision.revision_id)
        blockers.add("reference_not_in_snapshot");
      else if (!["PD", "RD"].includes(explicit.revision.fields.stage ?? ""))
        blockers.add("reference_stage_invalid");
      else if (!scope || key(explicit.revision.fields.scope) !== key(scope))
        blockers.add("reference_scope_mismatch");
      else pool = [explicit];
    } else {
      const expectedStage =
        stage === "ID" ? "RD" : stage === "RD" ? "PD" : null;
      if (!key(revision.fields.reference_code))
        blockers.add("reference_link_unconfirmed");
      else if (expectedStage && scope)
        pool = all.filter(
          (item) =>
            item.revision.revision_id !== revision.revision_id &&
            item.revision.fields.stage === expectedStage &&
            key(item.revision.fields.code) ===
              key(revision.fields.reference_code) &&
            key(item.revision.fields.scope) === key(scope),
        );
    }
    if (!pool.length) blockers.add("reference_missing");
    if (
      pool.length &&
      isIdentificationDate(from) &&
      isIdentificationDate(to) &&
      from <= to
    ) {
      // A chosen reference does not establish the applicability of another
      // revision of that same document. Unknown later changes must not be
      // silently filtered out in favour of the older approved revision.
      const relatedDocuments = new Set(
        pool.map((item) => item.document.document_id),
      );
      const related = all.filter(
        (item) =>
          relatedDocuments.has(item.document.document_id) &&
          (!key(item.revision.fields.scope) ||
            key(item.revision.fields.scope) === key(scope)),
      );
      if (
        related.some(
          (item) =>
            !["PD", "RD"].includes(item.revision.fields.stage ?? "") ||
            !approved(item.revision) ||
            !validApprovalPeriod(item.revision) ||
            !key(item.revision.fields.scope),
        )
      )
        blockers.add("reference_applicability_unconfirmed");
      if (
        related.some(
          (item) =>
            structuralBlockers(item.revision).length ||
            replacementProblems.has(item.revision.revision_id),
        )
      )
        blockers.add("reference_evidence_unresolved");
      const partiallyOverlapping = related.some(
        (item) =>
          approved(item.revision) &&
          validApprovalPeriod(item.revision) &&
          item.revision.approval.effective_from! <= to &&
          (item.revision.approval.effective_to === null ||
            item.revision.approval.effective_to >= from) &&
          !covers(item.revision, from, to),
      );
      if (partiallyOverlapping) blockers.add("reference_period_overlap");
      const approvedPool = pool.filter((item) => approved(item.revision));
      if (!approvedPool.length) blockers.add("reference_approval_unconfirmed");
      const covering = approvedPool.filter(
        (item) =>
          covers(item.revision, from, to) &&
          !structuralBlockers(item.revision).length &&
          !replacementProblems.has(item.revision.revision_id),
      );
      if (!covering.length)
        blockers.add("reference_period_or_evidence_unresolved");
      // A later approved replacement invalidates the predecessor from its
      // effective date, including periods that straddle the replacement.
      const applicable = covering.filter(
        (candidate) =>
          !all.some(
            (item) =>
              item.revision.approval.replaces_revision_id ===
                candidate.revision.revision_id &&
              approved(item.revision) &&
              validApprovalPeriod(item.revision) &&
              !replacementProblems.has(item.revision.revision_id) &&
              item.revision.approval.effective_from! <= to,
          ),
      );
      if (applicable.length === 1) selected = applicable[0]!;
      else if (applicable.length > 1) blockers.add("reference_ambiguous");
      else if (covering.length) blockers.add("replacement_period_conflict");
    }
    const actualRef = reference(actual);
    const selectedRef = selected ? reference(selected) : null;
    const context: ComparisonContext = {
      context_id: hash([actualRef, selectedRef, key(scope), from, to]),
      scope,
      works_period: { from, to },
      reference: selectedRef,
      actual: actualRef,
      status:
        selected && blockers.size === 0 ? "READY" : "CLARIFICATION_REQUIRED",
      blockers: [...blockers].sort(),
    };
    contexts.push(context);
    for (const blocker of context.blockers) snapshotBlockers.add(blocker);
  }
  return {
    schema_version: 1,
    documents,
    contexts: contexts.sort((a, b) => a.context_id.localeCompare(b.context_id)),
    blockers: [...snapshotBlockers].sort(),
  };
}
