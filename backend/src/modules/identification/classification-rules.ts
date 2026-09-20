import type {
  ParseArtifactData,
  ParseBlock,
} from "../parsing/parsing-contract.js";
import { blockText, evidenceFor } from "./classification-context.js";
import type {
  ClassificationCandidate,
  ClassificationStage,
} from "./classification-contract.js";

const AOSR = "http://idActs/AOSR.xsd";
const SCHEMA = "http://idCommon/AsBuiltSchemaDoc.xsd";
const COMMON = "http://types/CommonTypes.xsd";
const path = (parts: [string, string][]) =>
  "/" + parts.map(([ns, tag]) => `{${ns}}${tag}[1]`).join("/") + "/text()[1]";
const AOSR_NAME = path([
  [AOSR, "aosr"],
  [AOSR, "actInfo"],
  [COMMON, "documentInfo"],
  [COMMON, "name"],
]);
const SCHEMA_NAME = path([
  [SCHEMA, "asBuiltSchemaDoc"],
  [SCHEMA, "asBuiltSchemaDocInfo"],
  [SCHEMA, "docName"],
]);
const SCHEMA_TYPE = path([
  [SCHEMA, "asBuiltSchemaDoc"],
  [SCHEMA, "asBuiltSchemaDocInfo"],
  [SCHEMA, "docType"],
]);

function clean(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}
function title(
  text: string,
): { stage: ClassificationStage; kind: string | null } | null {
  const value = clean(text);
  if (value.length > 260) return null;
  if (/^проектная документация[.\s]*$/.test(value))
    return { stage: "PD", kind: null };
  if (/^рабочая документация[.\s]*$/.test(value))
    return { stage: "RD", kind: null };
  if (
    /^(?:акт\s+)?освидетельствования скрытых работ(?:\s*№.*)?[.\s]*$/.test(
      value,
    )
  )
    return { stage: "ID", kind: "Акт освидетельствования скрытых работ" };
  if (/^исполнительная схема(?:[.\s]|$)/.test(value))
    return { stage: "ID", kind: "Исполнительная схема" };
  if (/^реестр исполнительной документации(?:\s+от\s+\d|[.\s]*$)/.test(value))
    return { stage: "ID", kind: "Реестр исполнительной документации" };
  return null;
}
function referenceContext(blocks: ParseBlock[], index: number) {
  const text = blocks
    .slice(Math.max(0, index - 2), index + 1)
    .map(blockText)
    .join(" ");
  return /работы выполнены|приложени[яе]|ссылочн|перечень|содержание|ведомость|наименование исполнительной документации/i.test(
    text,
  );
}
function stage(value: string): ClassificationStage | null {
  const normalized = clean(value);
  return normalized === "п"
    ? "PD"
    : normalized === "р" || normalized === "p"
      ? "RD"
      : null;
}
function stampPosition(block: ParseBlock) {
  return block.bbox[0] >= 0.4 && block.bbox[1] >= 0.55;
}

export function classifyByRules(
  artifact: ParseArtifactData,
  format: string,
): ClassificationCandidate[] {
  const found: ClassificationCandidate[] = [];
  const add = (
    value: { stage: ClassificationStage; kind: string | null },
    block: ParseBlock,
    page: number,
    reason: string,
    supporting?: ParseBlock,
  ) => {
    found.push({
      stage: value.stage,
      document_kind: value.kind,
      method: "rules",
      reasons: [reason],
      evidence: [
        evidenceFor(block, page),
        ...(supporting ? [evidenceFor(supporting, page)] : []),
      ],
    });
  };
  for (const page of artifact.pages) {
    const blocks = page.blocks.filter(
      (block) => block.include_in_main !== false && blockText(block),
    );
    const hasOwnExecutiveTitle = blocks.some(
      (block, index) =>
        title(blockText(block))?.stage === "ID" &&
        !referenceContext(blocks, index) &&
        (index < 16 ||
          block.bbox[1] < 0.45 ||
          /^(?:акт\s+)?освидетельствования/i.test(blockText(block))),
    );
    for (const [index, block] of blocks.entries()) {
      const text = blockText(block);
      if (format.toLowerCase() === "xml") {
        // Only own fields of recognized namespaces. A referenced AOSR nested in
        // an unrelated wrapper is deliberately not recognized as the root document.
        if (
          block.structural_path === AOSR_NAME &&
          title(text)?.kind === "Акт освидетельствования скрытых работ"
        )
          add(
            { stage: "ID", kind: "Акт освидетельствования скрытых работ" },
            block,
            page.page_number,
            "xml_own_aosr_name",
          );
        if (
          (block.structural_path === SCHEMA_NAME &&
            clean(text) === "исполнительная схема") ||
          (block.structural_path === SCHEMA_TYPE && clean(text) === "ис")
        )
          add(
            { stage: "ID", kind: "Исполнительная схема" },
            block,
            page.page_number,
            "xml_own_as_built_schema",
          );
        continue;
      }
      if (referenceContext(blocks, index)) continue;
      const next = blocks[index + 1];
      const direct = title(text);
      const joined =
        !direct && next && !referenceContext(blocks, index + 1)
          ? title(`${text} ${blockText(next)}`)
          : null;
      const own = direct ?? joined;
      // A phrase embedded in prose, a contents row, or a numbered attachment
      // cannot establish the family of the containing document.
      if (
        own &&
        (own.stage !== "ID" ||
          index < 16 ||
          block.bbox[1] < 0.45 ||
          /^(?:акт\s+)?освидетельствования/i.test(text))
      )
        add(
          own,
          block,
          page.page_number,
          "own_document_title",
          joined ? next : undefined,
        );
      // An executive drawing can retain the working drawing's original stamp.
      // Explicit own titles still participate in conflict detection above.
      if (hasOwnExecutiveTitle || !stampPosition(block)) continue;
      const inline = /^стадия\s*[:.]?\s*([прp])$/i.exec(clean(text));
      if (inline) {
        const result = stage(inline[1]!);
        if (result)
          add(
            { stage: result, kind: null },
            block,
            page.page_number,
            "own_stage_cell",
          );
      }
      if (!/^стадия[.\s]*$/i.test(clean(text))) continue;
      const neighbors = blocks
        .slice(Math.max(0, index - 32), index + 33)
        .filter((other) => {
          if (other.id === block.id || !stage(blockText(other))) return false;
          if (block.table_id && other.table_id !== block.table_id) return false;
          const dx = Math.abs(
            (other.bbox[0] + other.bbox[2] - block.bbox[0] - block.bbox[2]) / 2,
          );
          const dy = Math.abs(
            (other.bbox[1] + other.bbox[3] - block.bbox[1] - block.bbox[3]) / 2,
          );
          return (
            (dx < 0.05 && dy < 0.08 && other.bbox[1] >= block.bbox[1]) ||
            (dy < 0.025 && dx < 0.12 && other.bbox[0] >= block.bbox[0])
          );
        });
      for (const neighbor of neighbors)
        add(
          { stage: stage(blockText(neighbor))!, kind: null },
          neighbor,
          page.page_number,
          "own_stage_cell",
          block,
        );
    }
  }
  // Preserve conflicting families even when a large file repeats one title.
  const grouped = new Map<string, ClassificationCandidate>();
  for (const item of found) {
    const key = `${item.stage}:${item.document_kind ?? ""}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, item);
    else {
      current.reasons = [...new Set([...current.reasons, ...item.reasons])];
      for (const evidence of item.evidence)
        if (
          current.evidence.length < 6 &&
          !current.evidence.some((e) => e.block_id === evidence.block_id)
        )
          current.evidence.push(evidence);
    }
  }
  return [...grouped.values()];
}
