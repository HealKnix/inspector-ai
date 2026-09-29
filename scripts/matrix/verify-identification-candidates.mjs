// Read-only replay of an explicitly supplied, authorised PAR diagnostic artifact.
import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { IDENTIFICATION_ENGINE_VERSION } from "../../backend/dist/modules/identification/identification-contract.js";
import { identifyArtifact } from "../../backend/dist/modules/identification/identification-engine.js";
import { validateArtifact } from "../../backend/dist/modules/parsing/parsing-contract.js";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Explicit authorised artifact and report paths required");
const bytes = await readFile(input);
const artifact = JSON.parse(bytes);
const origin = JSON.parse(
  await readFile(join(dirname(input), "summary.json"), "utf8"),
).cases.find((item) => item.id === "gi-rev3-p1");
assert.equal(
  origin.source_sha256,
  "b8b03fee48855b066fd27eb0c46c832cf2755870857208213eaebb5c33fc709f",
);
assert.deepEqual(origin.original_page_numbers, [1]);
const expectedSource = origin.selected_pdf_sha256;
assert.equal(
  artifact.source_sha256,
  expectedSource,
  "Only the declared diagnostic source is allowed",
);
validateArtifact(artifact, expectedSource, artifact.pipeline_fingerprint);
const hash = createHash("sha256").update(bytes).digest("hex");
assert.equal(hash, origin.artifact_sha256);
const revision = identifyArtifact({
  artifact,
  representation: {
    file_id: "00000000-0000-4000-8000-000000000001",
    artifact_id: "00000000-0000-4000-8000-000000000002",
    artifact_sha256: hash,
    source_sha256: expectedSource,
    format: "PDF",
    page_count: artifact.pages.length,
  },
});
const candidates = revision.candidates.filter((item) =>
  ["revision_label", "observed_replaced_sheet", "number"].includes(item.field),
);
assert.equal(
  candidates.find((item) => item.field === "revision_label")?.raw,
  "3",
);
assert.deepEqual(
  candidates
    .filter((item) => item.field === "observed_replaced_sheet")
    .map((item) => item.raw)
    .sort(),
  ["1", "4", "8"],
);
assert.equal(candidates.find((item) => item.field === "number")?.raw, "158-26");
assert.equal(revision.fields.revision_label, undefined);
assert.equal(revision.fields.observed_replaced_sheet, undefined);
assert.equal(revision.approval.confirmed, false);
assert(revision.blockers.includes("unsupported_partial_replacement"));
for (const candidate of candidates)
  for (const evidence of candidate.evidence) {
    const page = artifact.pages.find(
      (item) => item.page_number === evidence.page_number,
    );
    const block = page.blocks.find((item) => item.id === evidence.block_id);
    assert.equal(evidence.quote, block.raw_text || block.normalized_text);
    assert.deepEqual(evidence.bbox, block.bbox);
    assert.equal(evidence.artifact_sha256, hash);
    assert.equal(evidence.parse_context.native_valid, true);
    assert(evidence.parse_context.reasons.includes("LAYOUT_BOUNDARY_CONFLICT"));
  }
const report = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  qualification:
    "authorised diagnostic PAR replay; no new OCR, domain acceptance or active sheet selection",
  engine: IDENTIFICATION_ENGINE_VERSION,
  source_sha256: expectedSource,
  original_source_sha256: origin.source_sha256,
  original_page_numbers: origin.original_page_numbers,
  artifact_sha256: hash,
  pipeline_fingerprint: artifact.pipeline_fingerprint,
  candidates: candidates.map((item) => ({
    field: item.field,
    raw: item.raw,
    locator: {
      page_number: item.evidence[0].page_number,
      block_id: item.evidence[0].block_id,
      bbox: item.evidence[0].bbox,
    },
    context_block_ids: item.evidence.slice(1).map((e) => e.block_id),
  })),
  accepted_revision: false,
  selected_sheets: false,
  passed: true,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: true,
    candidates: candidates.length,
    engine: report.engine,
    report: output,
  }),
);
