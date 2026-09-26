import { describe, expect, it } from "vitest";
import type {
  ParseArtifactData,
  ParseBlock,
} from "../parsing/parsing-contract.js";
import {
  IDENTIFICATION_ENGINE_VERSION,
  validateClarificationBatch,
  validateRevisionApproval,
  type DocumentRepresentation,
  type IdentificationDocument,
  type IdentificationRevision,
} from "./identification-contract.js";
import {
  buildSelectionSnapshot,
  canMergeRepresentations,
  emptyRevisionApproval,
  identifyArtifact,
  mergeIdenticalRepresentations,
} from "./identification-engine.js";

const rep: DocumentRepresentation = {
  file_id: "file",
  artifact_id: "artifact",
  artifact_sha256: "b".repeat(64),
  source_sha256: "a".repeat(64),
  format: "XML",
  page_count: 1,
};
const A = "http://idActs/AOSR.xsd";
const C = "http://types/CommonTypes.xsd";
const B = "http://types/BaseDocument.xsd";
const p = (...items: [string, string][]) =>
  items.map(([ns, tag]) => `/{${ns}}${tag}[1]`).join("") + "/text()[1]";
const own = (tag: string) =>
  p([A, "aosr"], [A, "actInfo"], [C, "documentInfo"], [C, tag]);
const workLocation = (index = 1) =>
  p(
    [A, "aosr"],
    [A, "actInfo"],
    [A, "worksList"],
    [A, "worksListItem"],
    [A, "location"],
    [C, "place"],
  ).replace("worksListItem[1]", `worksListItem[${index}]`);
function block(
  id: string,
  text: string,
  structural_path: string | null = null,
): ParseBlock {
  return {
    id,
    order: 0,
    kind: "text",
    raw_text: text,
    normalized_text: text,
    bbox: [0.1, 0.1, 0.8, 0.2],
    confidence: null,
    source: structural_path ? "structured" : "native",
    structural_path,
    table_id: null,
    row: null,
    column: null,
    row_span: null,
    column_span: null,
  };
}
function artifact(blocks: ParseBlock[]): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: rep.source_sha256,
    pipeline_fingerprint: "c".repeat(64),
    versions: { parser: "synthetic" },
    raw_text: "",
    normalized_text: "",
    quality: "OK",
    reasons: [],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: null,
        width: 100,
        height: 100,
        image_key: "synthetic",
        image_sha256: "d".repeat(64),
        quality: "OK",
        reasons: [],
        transform: {},
        blocks,
      },
    ],
  };
}
function revision(
  id: string,
  stage: "PD" | "RD" | "ID",
  scope = "оси 1–3",
): IdentificationRevision {
  return {
    revision_id: id,
    fields: {
      stage,
      kind_code: stage === "ID" ? "AOSR" : "KJ",
      title: "Синтетический документ",
      number: "52",
      date: "2026-04-20",
      code: `${stage}-001`,
      scope,
      revision_label: "1",
      works_from: "2026-04-20",
      works_to: "2026-04-21",
    },
    candidates: [],
    representations: [{ ...rep, artifact_id: `artifact-${id}` }],
    approval: {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
      basis: "Синтетическое подтверждение",
    },
    blockers: [],
    reference_revision_id: null,
  };
}
function document(
  id: string,
  ...revisions: IdentificationRevision[]
): IdentificationDocument {
  return { document_id: id, card_version: 1, revisions };
}
function context(
  actual: IdentificationRevision,
  ...references: IdentificationRevision[]
) {
  return buildSelectionSnapshot([
    document("actual", actual),
    ...references.map((item) => document(`doc-${item.revision_id}`, item)),
  ]).contexts.find((item) => item.actual.revision_id === actual.revision_id)!;
}

describe("whole-document identification", () => {
  it("extracts AOSR 52 own work location with exact source evidence", () => {
    // Source values and QName paths from the real AOSR 52 XML dated
    // 2026-04-20; the surrounding parse envelope remains synthetic.
    const scope = "в осях 14-17/А-Ж на отм. -6.100";
    const scopeBlock = block("location", scope, workLocation());
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("name", "Акт освидетельствования скрытых работ", own("name")),
        block("number", "52", own("number")),
        block("date", "2026-04-20", own("date")),
        scopeBlock,
        ...(["beginDate", "endDate"] as const).map((tag) =>
          block(
            tag,
            "2026-04-20",
            p([A, "aosr"], [A, "actInfo"], [A, "worksDate"], [C, tag]),
          ),
        ),
      ]),
    });
    expect(result.fields).toMatchObject({
      stage: "ID",
      kind_code: "AOSR",
      number: "52",
      date: "2026-04-20",
      scope,
      works_from: "2026-04-20",
      works_to: "2026-04-20",
    });
    const candidate = result.candidates.find((item) => item.field === "scope");
    expect(candidate?.candidate_id).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate).toMatchObject({
      field: "scope",
      raw: scope,
      normalized: scope,
      role: "own",
      method: "rules",
      engine_version: IDENTIFICATION_ENGINE_VERSION,
      evidence: [
        {
          file_id: rep.file_id,
          artifact_id: rep.artifact_id,
          source_sha256: rep.source_sha256,
          artifact_sha256: rep.artifact_sha256,
          page_number: 1,
          block_id: scopeBlock.id,
          quote: scope,
          bbox: scopeBlock.bbox,
          structural_path: workLocation(),
        },
      ],
    });
    expect(result.approval).toEqual(emptyRevisionApproval());
    expect(result.blockers).toEqual([]);
  });
  it("keeps different own work locations unresolved instead of combining them", () => {
    const locations = ["оси 1-3/А-Б", "оси 8-10/В-Г"];
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact(
        locations.map((scope, index) =>
          block(`location-${index + 1}`, scope, workLocation(index + 1)),
        ),
      ),
    });
    expect(result.fields.scope).toBeUndefined();
    expect(result.blockers).toContain("field_conflict:scope");
    const candidates = result.candidates.filter(
      (item) => item.field === "scope",
    );
    expect(candidates).toHaveLength(2);
    for (const [index, scope] of locations.entries())
      expect(candidates.find((item) => item.raw === scope)).toMatchObject({
        role: "own",
        normalized: scope,
        evidence: [{ structural_path: workLocation(index + 1), quote: scope }],
      });
  });
  it("accepts repeated equal own locations while preserving both locators", () => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("one", "оси 1-3/А-Б", workLocation()),
        block("two", "  оси  1-3/А-Б  ", workLocation(2)),
      ]),
    });
    expect(result.fields.scope).toBe("оси 1-3/А-Б");
    expect(result.blockers).toEqual([]);
    expect(
      result.candidates.filter((item) => item.field === "scope"),
    ).toHaveLength(2);
  });
  it.each([
    [
      "attachment",
      workLocation().replace("worksList[1]", "attachmentsList[1]"),
    ],
    [
      "referenced document",
      workLocation().replace(
        "worksList[1]",
        "workAndProjectDocumentationsList[1]",
      ),
    ],
    [
      "different namespace",
      workLocation().replace(`{${C}}place`, "{other}place"),
    ],
    ["nested wrapper", "/{other}wrapper[1]" + workLocation()],
    [
      "work description",
      workLocation()
        .replace(`{${A}}location`, `{${A}}workDescription`)
        .replace(`{${C}}place`, `{${C}}workName`),
    ],
  ])("does not use %s as the act's work location", (_label, path) => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("number", "52", own("number")),
        block("unrelated-location", "оси 8-10/В-Г", path),
      ]),
    });
    expect(result.fields.scope).toBeUndefined();
    expect(result.candidates.some((item) => item.field === "scope")).toBe(
      false,
    );
  });
  it("keeps own XML metadata separate from attachments and both editions observed", () => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("name", "Акт освидетельствования скрытых работ", own("name")),
        block("number", "52", own("number")),
        block("date", "2026-04-20", own("date")),
        block("base-edition", "1", p([A, "aosr"], [B, "edition"])),
        block("own-edition", "13", own("edition")),
        block(
          "status",
          "Signed",
          p(
            [A, "aosr"],
            [A, "actsServiceAttributes"],
            [C, "status"],
            [C, "docStatus"],
          ),
        ),
        block(
          "attachment",
          "99",
          p(
            [A, "aosr"],
            [A, "actInfo"],
            [A, "attachmentsList"],
            [A, "attachmentsListItem"],
            [C, "document"],
            [C, "number"],
          ),
        ),
      ]),
    });
    expect(result.fields).toMatchObject({
      stage: "ID",
      kind_code: "AOSR",
      number: "52",
      date: "2026-04-20",
      observed_status: "Signed",
    });
    expect(result.fields.revision_label).toBeUndefined();
    expect(result.approval.confirmed).toBe(false);
    expect(
      result.candidates
        .filter((item) => item.field === "observed_edition")
        .map((item) => item.raw)
        .sort(),
    ).toEqual(["1", "13"]);
    expect(result.candidates.find((item) => item.raw === "99")?.role).toBe(
      "reference",
    );
    expect(result.candidates[0]!.evidence[0]).toMatchObject({
      file_id: "file",
      artifact_id: "artifact",
      source_sha256: rep.source_sha256,
      artifact_sha256: rep.artifact_sha256,
    });
  });
  it("extracts only an own explicit AOSR reference to RD, not its own code", () => {
    const path = p(
      [A, "aosr"],
      [A, "actInfo"],
      [A, "workAndProjectDocumentationsList"],
      [A, "workAndProjectDocumentationsListItem"],
      [A, "workAndProjectDocumentation"],
      [C, "obligatoryWorkDocumentation"],
      [C, "workDocumentationSectionsList"],
      [C, "workDocumentationSectionsListItem"],
      [C, "workDocumentationSectionCode"],
    );
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([block("ref", "23.009-Р-ГИ", path)]),
    });
    expect(result.fields.reference_code).toBe("23.009-Р-ГИ");
    expect(result.fields.code).toBeUndefined();
    expect(result.candidates[0]!.role).toBe("reference");
  });
  it("rejects source/hash or page-count mismatch", () => {
    expect(() =>
      identifyArtifact({
        representation: { ...rep, source_sha256: "x" },
        artifact: artifact([]),
      }),
    ).toThrow("identification_artifact_mismatch");
    expect(() =>
      identifyArtifact({
        representation: { ...rep, page_count: 2 },
        artifact: artifact([]),
      }),
    ).toThrow("identification_artifact_mismatch");
  });
  it("does not use similarly named own fields inside a wrapper", () => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("fake", "52", "/{other}wrapper[1]" + own("number")),
      ]),
    });
    expect(result.fields.number).toBeUndefined();
    expect(result.blockers).toContain("unsupported_xml_schema");
  });
  it("conflicting own values abstain", () => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([
        block("one", "52", own("number")),
        block("two", "53", own("number")),
      ]),
    });
    expect(result.fields.number).toBeUndefined();
    expect(result.blockers).toContain("field_conflict:number");
  });
  it("identifies native own title/labels without filename inference", () => {
    const result = identifyArtifact({
      representation: { ...rep, format: "PDF" },
      artifact: artifact([
        block("title", "Рабочая документация"),
        block("code", "Шифр: 23.009-Р-ГИ"),
        block("revision", "Редакция: 2"),
        block("period", "Период работ: 20.04.2026 — 21.04.2026"),
      ]),
    });
    expect(result.fields).toMatchObject({
      stage: "RD",
      code: "23.009-Р-ГИ",
      revision_label: "2",
      works_from: "2026-04-20",
      works_to: "2026-04-21",
    });
  });
  it("marks mixed documents and partial replacement unsupported", () => {
    const result = identifyArtifact({
      representation: { ...rep, format: "PDF" },
      artifact: artifact([
        block("first", "Рабочая документация"),
        block("second", "Акт освидетельствования скрытых работ"),
        block("partial", "Замена отдельных листов"),
      ]),
    });
    expect(result.blockers).toContain("unsupported_mixed_document");
    expect(result.blockers).toContain("unsupported_partial_replacement");
  });
  it("OCR and LLM proposals do not automatically confirm fields or approval", () => {
    const source = artifact([
      { ...block("ocr", "Рабочая документация"), source: "ocr" },
    ]);
    const result = identifyArtifact({
      representation: { ...rep, format: "PDF" },
      artifact: source,
      classification: {
        schema_version: 1,
        stage: "RD",
        document_kind: "Рабочая документация",
        method: "llm",
        needs_review: true,
        reasons: [],
        candidates: [],
        evidence: [
          {
            page_number: 1,
            block_id: "ocr",
            quote: "Рабочая документация",
            bbox: [0.1, 0.1, 0.8, 0.2],
            structural_path: null,
          },
        ],
        versions: {
          classifier: "test",
          rules: "test",
          context: "test",
          prompt: "test",
          model: "test",
        },
      },
    });
    expect(result.fields.stage).toBeUndefined();
    expect(result.candidates.some((item) => item.method === "llm")).toBe(true);
    expect(result.approval.confirmed).toBe(false);
  });
  it("retains malformed dates as raw candidates, without inventing a date", () => {
    const result = identifyArtifact({
      representation: rep,
      artifact: artifact([block("date", "2026-02-31", own("date"))]),
    });
    expect(result.candidates[0]!.raw).toBe("2026-02-31");
    expect(result.candidates[0]!.normalized).toBeNull();
    expect(result.fields.date).toBeUndefined();
  });
});

describe("strict representation identity", () => {
  it("merges fully identical PDF/XML without mutating inputs", () => {
    const xml = revision("b", "ID");
    const pdf = revision("a", "ID");
    pdf.representations[0]!.format = "PDF";
    expect(canMergeRepresentations(pdf, xml)).toBe(true);
    const result = mergeIdenticalRepresentations([xml, pdf]);
    expect(result).toHaveLength(1);
    expect(result[0]!.representations).toHaveLength(2);
    expect(pdf.representations).toHaveLength(1);
  });
  it.each(["scope", "works_from", "kind_code", "date"] as const)(
    "does not merge when %s is missing",
    (field) => {
      const xml = revision("b", "ID");
      const pdf = revision("a", "ID");
      pdf.representations[0]!.format = "PDF";
      delete xml.fields[field];
      expect(canMergeRepresentations(pdf, xml)).toBe(false);
    },
  );
  it("does not require an unobserved revision label and accepts XML-only external ID", () => {
    const xml = revision("b", "ID");
    const pdf = revision("a", "ID");
    pdf.representations[0]!.format = "PDF";
    delete xml.fields.revision_label;
    delete pdf.fields.revision_label;
    xml.fields.external_id = "external";
    expect(canMergeRepresentations(pdf, xml)).toBe(true);
  });
  it("does not merge different scopes, editions, stages or external IDs", () => {
    const xml = revision("b", "ID");
    const pdf = revision("a", "ID");
    pdf.representations[0]!.format = "PDF";
    xml.fields.external_id = "first";
    pdf.fields.external_id = "first";
    for (const fields of [
      { scope: "оси 4–7" },
      { revision_label: "2" },
      { stage: "RD" },
      { external_id: "different" },
    ])
      expect(
        canMergeRepresentations(pdf, {
          ...xml,
          fields: { ...xml.fields, ...fields },
        }),
      ).toBe(false);
  });
});

describe("reference selection", () => {
  it("selects ID→RD only with explicit code, scope, approval and full work period", () => {
    const actual = revision("id", "ID");
    const rd = revision("rd", "RD");
    actual.fields.reference_code = rd.fields.code;
    expect(context(actual, rd)).toMatchObject({
      status: "READY",
      reference: { revision_id: "rd" },
      works_period: { from: "2026-04-20", to: "2026-04-21" },
    });
  });
  it("does not infer RD→PD from stage alone", () => {
    expect(context(revision("rd", "RD"), revision("pd", "PD"))).toMatchObject({
      status: "CLARIFICATION_REQUIRED",
      reference: null,
    });
  });
  it("has no automatic ID→PD fallback", () => {
    const actual = revision("id", "ID");
    const pd = revision("pd", "PD");
    actual.fields.reference_code = pd.fields.code;
    expect(context(actual, pd).blockers).toContain("reference_missing");
  });
  it("supports an explicit inspector reference but still enforces scope/approval/time", () => {
    const actual = revision("id", "ID");
    const pd = revision("pd", "PD");
    actual.reference_revision_id = pd.revision_id;
    expect(context(actual, pd).status).toBe("READY");
    expect(
      context(actual, { ...pd, fields: { ...pd.fields, scope: "other" } })
        .blockers,
    ).toContain("reference_scope_mismatch");
    expect(
      context(actual, { ...pd, approval: emptyRevisionApproval() }).blockers,
    ).toContain("reference_approval_unconfirmed");
    expect(
      context(actual, {
        ...pd,
        approval: { ...pd.approval, effective_from: "2026-05-01" },
      }).status,
    ).toBe("CLARIFICATION_REQUIRED");
  });
  it("does not use document issue date when works dates are absent", () => {
    const actual = revision("id", "ID");
    actual.reference_revision_id = "rd";
    delete actual.fields.works_from;
    expect(context(actual, revision("rd", "RD")).blockers).toContain(
      "works_period_unresolved",
    );
  });
  it("keeps unknown approval dates and unapproved actual revisions unresolved", () => {
    const actual = revision("id", "ID");
    actual.reference_revision_id = "rd";
    expect(
      context(actual, {
        ...revision("rd", "RD"),
        approval: { ...revision("rd", "RD").approval, effective_from: null },
      }).status,
    ).toBe("CLARIFICATION_REQUIRED");
    actual.approval = emptyRevisionApproval();
    expect(context(actual, revision("rd", "RD")).blockers).toContain(
      "actual_approval_unconfirmed",
    );
  });
  it("multiple matching references require clarification", () => {
    const actual = revision("id", "ID");
    actual.fields.reference_code = "RD-001";
    expect(
      context(actual, revision("rd1", "RD"), revision("rd2", "RD")).blockers,
    ).toContain("reference_ambiguous");
  });
  it("selects an approved replacement for a later period, but refuses a straddling period", () => {
    const old = revision("old", "RD");
    const next = revision("new", "RD");
    next.approval.replaces_revision_id = "old";
    next.approval.effective_from = "2026-04-20";
    const actual = revision("id", "ID");
    actual.fields.reference_code = "RD-001";
    const run = () =>
      buildSelectionSnapshot([
        document("rd", old, next),
        document("id", actual),
      ]).contexts.find((item) => item.actual.revision_id === "id")!;
    expect(run()).toMatchObject({
      status: "READY",
      reference: { revision_id: "new" },
    });
    actual.fields.works_from = "2026-04-19";
    expect(run().blockers).toContain("replacement_period_conflict");
  });
  it("does not permit an explicit obsolete predecessor after replacement", () => {
    const old = revision("old", "RD");
    const next = revision("new", "RD");
    next.approval.replaces_revision_id = "old";
    next.approval.effective_from = "2026-04-20";
    const actual = revision("id", "ID");
    actual.reference_revision_id = "old";
    const result = buildSelectionSnapshot([
      document("rd", old, next),
      document("id", actual),
    ]).contexts.find((item) => item.actual.revision_id === "id")!;
    expect(result.blockers).toContain("replacement_period_conflict");
  });
  it.each(["automatic", "explicit"])(
    "%s selection cannot ignore a sibling with unconfirmed applicability",
    (mode) => {
      const old = revision("old", "RD");
      const later = revision("later", "RD");
      later.approval = emptyRevisionApproval();
      const actual = revision("id", "ID");
      actual.fields.reference_code = "RD-001";
      if (mode === "explicit") actual.reference_revision_id = "old";
      const selected = () =>
        buildSelectionSnapshot([
          document("rd", old, later),
          document("id", actual),
        ]).contexts.find((item) => item.actual.revision_id === "id")!;
      expect(selected().status).toBe("CLARIFICATION_REQUIRED");
      expect(selected().blockers).toContain(
        "reference_applicability_unconfirmed",
      );
      later.approval = { ...old.approval, effective_from: null };
      expect(selected().blockers).toContain(
        "reference_applicability_unconfirmed",
      );
    },
  );
  it("an overlapping sibling with a shorter period cannot be ignored", () => {
    const old = revision("old", "RD");
    const partial = revision("partial", "RD");
    partial.approval.effective_from = "2026-04-21";
    const actual = revision("id", "ID");
    actual.reference_revision_id = "old";
    const result = buildSelectionSnapshot([
      document("rd", old, partial),
      document("id", actual),
    ]).contexts.find((item) => item.actual.revision_id === "id")!;
    expect(result.blockers).toContain("reference_period_overlap");
    expect(result.status).toBe("CLARIFICATION_REQUIRED");
  });
  it("rejects replacement cycles and foreign-document replacements", () => {
    const first = revision("first", "RD");
    const second = revision("second", "RD");
    first.approval.replaces_revision_id = "second";
    second.approval.replaces_revision_id = "first";
    expect(
      buildSelectionSnapshot([document("rd", first, second)]).blockers,
    ).toContain("replacement_cycle");
    expect(
      buildSelectionSnapshot([document("one", first), document("two", second)])
        .blockers,
    ).toContain("replacement_target_invalid");
  });
  it("keeps unrelated scopes separate and output deterministic under input ordering", () => {
    const first = revision("a", "ID", "scope-a");
    const second = revision("b", "ID", "scope-b");
    first.reference_revision_id = "ref-a";
    second.reference_revision_id = "ref-b";
    const docs = [
      document("a", first),
      document("b", second),
      document("ra", revision("ref-a", "RD", "scope-a")),
      document("rb", revision("ref-b", "RD", "scope-b")),
    ];
    expect(buildSelectionSnapshot(docs)).toEqual(
      buildSelectionSnapshot([...docs].reverse()),
    );
    const contexts = buildSelectionSnapshot(docs).contexts.filter(
      (item) =>
        item.actual.revision_id === "a" || item.actual.revision_id === "b",
    );
    expect(new Set(contexts.map((item) => item.context_id)).size).toBe(2);
    expect(contexts.every((item) => item.status === "READY")).toBe(true);
  });
});

describe("clarification transport boundary", () => {
  const uuid = "12345678-1234-4123-8123-123456789012";
  const batch = () => ({
    request_id: uuid,
    expected_run_id: uuid,
    documents: [
      {
        document_id: uuid,
        expected_version: 1,
        revisions: [
          { revision_id: uuid, fields: { scope: "scope", number: null } },
        ],
      },
    ],
    basis: "Источник проверен инспектором",
  });
  it("supports explicit unset and rejects unknown fields/client evidence", () => {
    expect(
      validateClarificationBatch(batch()).documents[0]!.revisions[0]!.fields
        ?.number,
    ).toBeNull();
    expect(() =>
      validateClarificationBatch({ ...batch(), role: "ADMINISTRATOR" }),
    ).toThrow();
    const invalid = batch();
    Object.assign(invalid.documents[0]!.revisions[0]!, { candidates: [] });
    expect(() => validateClarificationBatch(invalid)).toThrow();
  });
  it("requires basis, optimistic version and unique document edits", () => {
    expect(() =>
      validateClarificationBatch({ ...batch(), basis: "   " }),
    ).toThrow();
    const invalid = batch();
    invalid.documents[0]!.expected_version = 0;
    expect(() => validateClarificationBatch(invalid)).toThrow();
    expect(() =>
      validateClarificationBatch({
        ...batch(),
        documents: [batch().documents[0], batch().documents[0]],
      }),
    ).toThrow();
  });
  it("does not accept confirmed Signed, missing approval basis or inverted dates", () => {
    expect(() =>
      validateRevisionApproval({ ...emptyRevisionApproval(), confirmed: true }),
    ).toThrow();
    expect(() =>
      validateRevisionApproval({
        ...emptyRevisionApproval(),
        confirmed: "Signed",
      }),
    ).toThrow();
    expect(() =>
      validateRevisionApproval({
        ...emptyRevisionApproval(),
        effective_from: "2026-03-01",
        effective_to: "2026-02-01",
      }),
    ).toThrow();
  });
  it.each([0, false, {}, [], ""])(
    "rejects malformed approval dates instead of stringifying %j",
    (value) => {
      for (const field of ["effective_from", "effective_to"] as const)
        expect(() =>
          validateRevisionApproval({
            ...emptyRevisionApproval(),
            [field]: value,
          }),
        ).toThrow("identification_invalid_period");
    },
  );
});
