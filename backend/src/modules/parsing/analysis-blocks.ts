import type { ParseBlock, ParsePage } from "./parsing-contract.js";

/** Original blocks and locators remain immutable. Display inclusion is not
 * analysis eligibility: valid native text in skipped regions is still usable.
 * Legacy hidden text has no validated-native signal and must not be promoted.
 */
export function analysisBlocks(page: ParsePage): ParseBlock[] {
  const regions = new Map(
    (page.regions ?? []).map((region) => [region.id, region]),
  );
  return page.blocks.filter((block) => {
    if (
      block.native_valid === false ||
      block.provenance?.status === "ambiguous" ||
      block.provenance?.reasons.includes("DUPLICATE_NATIVE_READING")
    )
      return false;
    if (block.include_in_main !== false) return true;
    return (
      block.source === "native" &&
      block.native_valid === true &&
      regions.get(block.region_id ?? "")?.method === "skipped"
    );
  });
}
