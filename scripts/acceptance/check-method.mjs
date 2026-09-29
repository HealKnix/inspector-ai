import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { sha256 } from "./inventory.mjs";
import {
  groupMetrics,
  objectBootstrap,
  ocrMetrics,
  rectangleIoU,
} from "./metrics.mjs";
import { validateSubmission } from "./submission.mjs";

export function checkMethod() {
  const base = new URL("../../docs/acceptance/", import.meta.url);
  const root = new URL("../../", import.meta.url);
  const json = (path) => JSON.parse(readFileSync(new URL(path, base), "utf8"));
  const errors = [];
  const assert = (ok, message) => {
    if (!ok) errors.push(message);
  };
  const ledger = json("requirements.json");
  const ids = ledger.rows.map((r) => r.id);
  assert(ids.length === new Set(ids).size, "duplicate requirement id");
  for (let i = 1; i <= 24; i++)
    assert(ids.includes(`C${String(i).padStart(2, "0")}`), `missing C${i}`);
  for (const high of [
    "HIGH-1",
    "HIGH-2",
    "HIGH-3",
    "HIGH-4",
    "HIGH-5",
    "HIGH-12",
  ])
    assert(ids.includes(high), `missing ${high}`);
  for (const row of ledger.rows)
    assert(
      row.owner?.length &&
        row.H &&
        row.F === "required" &&
        row.source &&
        row.verification &&
        row.execution_status === "NOT_RUN",
      `incomplete requirement ${row.id} or unsupported product acceptance claim`,
    );
  const sources = json("sources.json").sources;
  for (const source of sources.filter((s) => s.path))
    assert(
      sha256(readFileSync(new URL(source.path, root))) === source.sha256,
      `source digest mismatch ${source.id}`,
    );
  const inventory = json("contracts/input-inventory.json");
  assert(
    inventory.passed &&
      inventory.errors.length === 0 &&
      inventory.hidden_answers_read === false,
    "inventory did not pass or hidden read",
  );
  assert(
    inventory.archive_matches_current.every((r) => r.matches_current) &&
      inventory.public_checksums.every((r) => r.match),
    "source package checksum/archive mismatch",
  );
  for (const name of [
    "submission_schema.json",
    "split_policy.json",
    "scoring_summary_without_answers.json",
  ]) {
    const source = inventory.sources.find(
      (s) =>
        s.role === "participant_public_contract_or_metadata" &&
        s.path.endsWith(`/data/${name}`),
    );
    assert(
      source &&
        sha256(readFileSync(new URL(`contracts/${name}`, base))) ===
          source.sha256,
      `copied contract digest mismatch ${name}`,
    );
  }
  const manifest = json("contracts/permitted-manifest.json");
  const split = json("development-split.json");
  const official = json("contracts/split_policy.json");
  const actualObjects = [...split.train, ...split.validation, ...split.hidden];
  assert(
    actualObjects.length === new Set(actualObjects).size,
    "object overlap between splits",
  );
  assert(
    [...split.train, ...split.validation].every((v) =>
      official.TRAIN_PUBLIC.includes(v),
    ) && split.hidden.every((v) => official.TEST_HIDDEN.includes(v)),
    "development split changes official isolation",
  );
  assert(
    split.required_hidden_case_types.length === 5 &&
      [
        "confirmed_positive",
        "verified_negative",
        "missing_evidence",
        "not_applicable",
        "revision_conflict",
      ].every((v) => split.required_hidden_case_types.includes(v)),
    "missing required hidden category",
  );
  assert(
    split.official_manifest_sha256 ===
      inventory.sources.find(
        (s) =>
          s.role === "participant_public_contract_or_metadata" &&
          s.path.endsWith("/document_manifest.jsonl"),
      ).sha256,
    "wrong manifest version",
  );
  assert(
    split.permitted_manifest_content_sha256 ===
      sha256(JSON.stringify(manifest)),
    "permitted manifest content changed",
  );
  assert(
    manifest.length === 416 &&
      new Set(manifest.map((r) => r.file_id)).size === 416,
    "bad manifest cardinality/duplicate",
  );
  for (const file of manifest)
    assert(
      actualObjects.includes(file.object_id) &&
        (official.TRAIN_PUBLIC.includes(file.object_id)
          ? file.split === "TRAIN_PUBLIC"
          : file.split === "TEST_HIDDEN"),
      `bad split ${file.file_id}`,
    );
  const codes = json("contracts/parameter-codes.json");
  const codeMap = json("contracts/parameter-code-map.json");
  assert(
    codeMap.rows.length === 132 &&
      new Set(codeMap.rows.map((r) => r.internal_code)).size === 132 &&
      new Set(codeMap.rows.map((r) => r.submission_code)).size === 132 &&
      codeMap.rows.every((r) => codes.includes(r.submission_code)),
    "invalid internal/external code mapping",
  );
  assert(
    sha256(readFileSync(new URL(codeMap.internal_source.path, root))) ===
      codeMap.internal_source.sha256,
    "internal catalog changed; recheck external code correspondence",
  );
  assert(
    codes.length === 132 && new Set(codes).size === 132,
    "catalog must have132 unique codes",
  );
  const integrity = json("contracts/public-file-integrity.json");
  assert(
    integrity.passed &&
      integrity.total === 203 &&
      integrity.verified === 203 &&
      integrity.hidden_files_read === 0 &&
      integrity.manifest_sha256 === split.official_manifest_sha256,
    "original public bytes not verified",
  );
  for (const result of integrity.files)
    assert(
      result.matched &&
        manifest.find(
          (r) => r.file_id === result.file_id && r.split === "TRAIN_PUBLIC",
        )?.sha256 === result.sha256,
      `original digest inconsistent ${result.file_id}`,
    );
  const valid = validateSubmission(
    json("fixtures/submission-valid.synthetic.json"),
  );
  const invalid = validateSubmission(
    json("fixtures/submission-invalid.synthetic.json"),
  );
  assert(
    valid.schema_valid && valid.semantic_valid && !invalid.schema_valid,
    "schema control failed",
  );
  const ocr = ocrMetrics([
    {
      kind: "printed",
      dpi: 300,
      expected: "a b c",
      actual: "a b x",
      status: "PROCESSED",
    },
  ]);
  const empty = groupMetrics([], []);
  const iou = rectangleIoU([0, 0, 1, 1], [0, 0, 0.5, 1]);
  const ci = objectBootstrap(
    [
      { object_id: "synthetic-a", value: 0 },
      { object_id: "synthetic-b", value: 1 },
    ],
    (rows) => rows.reduce((sum, row) => sum + row.value, 0) / rows.length,
  );
  assert(
    ocr.character_accuracy === 0.8 &&
      ocr.wer === 1 / 3 &&
      iou === 0.5 &&
      empty.f1 === null &&
      JSON.stringify(ci.interval) === "[0,1]",
    "manual metric controls failed",
  );
  return {
    method_version: ledger.method_version,
    scope: "methodology controls, not product acceptance",
    passed: !errors.length,
    requirements: ledger.rows.length,
    roadmap: 24,
    high_modules: 6,
    original_public_files_verified: integrity.verified,
    hidden_files_read: 0,
    external_sources: sources
      .filter((s) => !s.path)
      .map((s) => ({
        id: s.id,
        sha256: s.sha256,
        verification:
          "primary checked during initial run; external source required to repeat byte verification",
      })),
    controls: {
      character_accuracy: ocr.character_accuracy,
      cer: ocr.cer,
      wer: ocr.wer,
      rectangle_iou: iou,
      empty_f1: empty.f1,
      bootstrap_ci95: ci.interval,
      valid_schema: valid.schema_valid,
      invalid_schema_rejected: !invalid.schema_valid,
    },
    errors,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkMethod();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
