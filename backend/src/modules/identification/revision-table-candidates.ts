import { analysisBlocks } from "../parsing/analysis-blocks.js";
import type { ParseBlock, ParsePage } from "../parsing/parsing-contract.js";

export interface RevisionTableCandidate {
  field: "number" | "revision_label" | "observed_replaced_sheet";
  value: ParseBlock;
  context: ParseBlock[];
}

const text = (block: ParseBlock) =>
  (block.raw_text || block.normalized_text).trim();
const centerX = (block: ParseBlock) => (block.bbox[0] + block.bbox[2]) / 2;
const centerY = (block: ParseBlock) => (block.bbox[1] + block.bbox[3]) / 2;
const sameRow = (left: ParseBlock, right: ParseBlock) =>
  Math.abs(centerY(left) - centerY(right)) <=
  Math.min(
    0.02,
    Math.max(left.bbox[3] - left.bbox[1], right.bbox[3] - right.bbox[1]),
  );
const inColumn = (value: ParseBlock, header: ParseBlock) =>
  value.bbox[0] >= header.bbox[0] - 0.015 &&
  value.bbox[2] <= header.bbox[2] + 0.015;

/** Candidate discovery only. Geometry here locates printed metadata, never
 * measures a drawing or proves a revision's approval or replacement scope.
 * Bounded to one unambiguous permission table and its nearby numeric labels.
 */
export function revisionTableCandidates(
  page: ParsePage,
): RevisionTableCandidate[] {
  const eligible = analysisBlocks(page);
  if (eligible.length > 200) return [];
  const blocks = eligible.filter(
    (block) =>
      block.source === "native" &&
      block.native_valid === true &&
      text(block).length > 0 &&
      text(block).length <= 600,
  );
  const permissions = blocks.filter((block) =>
    /^Разрешение$/iu.test(text(block)),
  );
  const changes = blocks.filter((block) => /^Изм\.$/iu.test(text(block)));
  if (permissions.length !== 1 || changes.length !== 1) return [];
  const permission = permissions[0]!;
  const change = changes[0]!;
  if (permission.bbox[3] >= change.bbox[1]) return [];
  const sheets = blocks.filter(
    (block) =>
      /^Лист$/iu.test(text(block)) &&
      sameRow(change, block) &&
      centerX(block) > centerX(change),
  );
  const contents = blocks.filter(
    (block) =>
      /^Содержание изменения$/iu.test(text(block)) && sameRow(change, block),
  );
  if (sheets.length !== 1 || contents.length !== 1) return [];
  const sheet = sheets[0]!;
  const content = contents[0]!;
  if (centerX(sheet) >= centerX(content)) return [];
  const body = blocks.filter(
    (block) =>
      block.bbox[1] > change.bbox[3] && block.bbox[3] <= change.bbox[3] + 0.25,
  );
  const replacements = body.filter(
    (block) =>
      /^Замена листа$/iu.test(text(block)) && block.bbox[0] > content.bbox[2],
  );
  const results: RevisionTableCandidate[] = [];
  for (const replacement of replacements.slice(0, 32)) {
    const values = body.filter(
      (block) =>
        /^\d{1,4}[а-яa-z]?$/iu.test(text(block)) &&
        inColumn(block, sheet) &&
        sameRow(block, replacement),
    );
    if (values.length === 1)
      results.push({
        field: "observed_replaced_sheet",
        value: values[0]!,
        context: [permission, change, sheet, content, replacement],
      });
  }
  if (!results.length) return [];
  const revisions = body.filter(
    (block) =>
      /^\d{1,4}$/u.test(text(block)) &&
      inColumn(block, change) &&
      results.some((item) => sameRow(block, item.value)),
  );
  for (const value of revisions)
    results.push({
      field: "revision_label",
      value,
      context: [permission, change, sheet, content],
    });
  const numbers = blocks.filter(
    (block) =>
      /^\d{1,8}-\d{2,4}$/u.test(text(block)) &&
      inColumn(block, permission) &&
      block.bbox[1] > permission.bbox[3] &&
      block.bbox[3] < change.bbox[1] &&
      block.bbox[3] - permission.bbox[3] <= 0.08,
  );
  if (numbers.length === 1)
    results.push({
      field: "number",
      value: numbers[0]!,
      context: [permission],
    });
  return results;
}
