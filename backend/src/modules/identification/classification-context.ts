import { analysisBlocks } from "../parsing/analysis-blocks.js";
import type {
  ParseArtifactData,
  ParseBlock,
} from "../parsing/parsing-contract.js";
import type { ClassificationEvidence } from "./classification-contract.js";

export interface ClassificationFragment extends ClassificationEvidence {
  text: string;
}
export interface ClassificationContext {
  fragments: ClassificationFragment[];
  total_pages: number;
  sampled_pages: number[];
  truncated: boolean;
}
export const MAX_CONTEXT_CHARACTERS = 18_000;
export const MAX_CONTEXT_FRAGMENTS = 48;
export const MAX_FRAGMENT_CHARACTERS = 900;
const ANCHOR = /документаци|стадия|освидетельствован|исполнительн|аоср/i;
function excerpt(text: string): string {
  const match = ANCHOR.exec(text);
  const start =
    match && match.index >= MAX_FRAGMENT_CHARACTERS
      ? Math.max(0, match.index - 160)
      : 0;
  return text.slice(start, start + MAX_FRAGMENT_CHARACTERS);
}

export function blockText(block: ParseBlock): string {
  return (block.normalized_text || block.raw_text).trim();
}
export function evidenceFor(
  block: ParseBlock,
  page: number,
  quote?: string,
): ClassificationEvidence {
  return {
    page_number: page,
    block_id: block.id,
    quote: (quote ?? blockText(block)).slice(0, MAX_FRAGMENT_CHARACTERS),
    bbox: [...block.bbox],
    structural_path: block.structural_path,
  };
}

/** No full-document text, filenames or signatures cross the provider boundary. */
export function buildClassificationContext(
  artifact: ParseArtifactData,
): ClassificationContext {
  const pages = artifact.pages.map((page) => ({
    number: page.page_number,
    items: analysisBlocks(page).filter(
      (block) =>
        blockText(block) &&
        !/xmldsig|Signature|X509|SignatureValue/.test(
          block.structural_path ?? "",
        ),
    ),
  }));
  const candidates: {
    block: ParseBlock;
    page: number;
    priority: number;
    position: number;
  }[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.items.length; i++) {
      const block = page.items[i]!;
      const anchor = ANCHOR.test(blockText(block));
      if (anchor) {
        for (
          let j = Math.max(0, i - 1);
          j <= Math.min(page.items.length - 1, i + 1);
          j++
        )
          candidates.push({
            block: page.items[j]!,
            page: page.number,
            priority: j === i ? 0 : 1,
            position: j,
          });
      } else if (i < 3 || (block.bbox[1] < 0.25 && i < 8))
        candidates.push({ block, page: page.number, priority: 2, position: i });
    }
  }
  // Round-robin page coverage avoids spending the entire budget on page one.
  candidates.sort(
    (a, b) =>
      a.priority - b.priority || a.position - b.position || a.page - b.page,
  );
  const fragments: ClassificationFragment[] = [];
  const seen = new Set<string>();
  let characters = 0;
  let truncated = false;
  for (const item of candidates) {
    if (seen.has(item.block.id)) continue;
    seen.add(item.block.id);
    const text = excerpt(blockText(item.block));
    const evidence = evidenceFor(item.block, item.page, text);
    // The full locator is included in the budget, never silently rewritten.
    const size = JSON.stringify({ ...evidence, text }).length;
    if (
      fragments.length >= MAX_CONTEXT_FRAGMENTS ||
      characters + size > MAX_CONTEXT_CHARACTERS
    ) {
      truncated = true;
      continue;
    }
    fragments.push({ ...evidence, text });
    characters += size;
    if (text.length < blockText(item.block).length) truncated = true;
  }
  fragments.sort(
    (a, b) => a.page_number - b.page_number || a.bbox[1] - b.bbox[1],
  );
  return {
    fragments,
    total_pages: artifact.pages.length,
    sampled_pages: [...new Set(fragments.map((f) => f.page_number))],
    truncated,
  };
}
