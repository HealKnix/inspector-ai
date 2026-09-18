import type { TextBlock } from "@/api/types/parsing";

export function isVisibleDocumentBlock(block: TextBlock) {
  return (
    block.kind === "table_cell" ||
    block.source !== "ocr" ||
    Boolean(block.raw_text.trim() || block.normalized_text.trim())
  );
}
