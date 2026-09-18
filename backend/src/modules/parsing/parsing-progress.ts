import { HASH, record, UUID } from "./parsing-contract.js";

export const PARSER_STAGES = [
  "starting",
  "checkpoint_verifying",
  "resuming",
  "rendering",
  "layout",
  "extracting",
  "ocr",
  "complete",
] as const;
export const PARSING_PHASES = [
  "checking_parser",
  "waiting_models",
  "waiting_capacity",
  "starting",
  "checkpoint_verifying",
  "resuming",
  "rendering",
  "layout",
  "extracting",
  "ocr",
  "publishing",
  "retry_delay",
] as const;
export type ParsingPhase = (typeof PARSING_PHASES)[number];
export type WaitingReason =
  "models_not_ready" | "parser_busy" | "retry_backoff";
export interface ParserProgress {
  request_id: string;
  pipeline_fingerprint: string;
  stage: (typeof PARSER_STAGES)[number];
  pages_completed: number;
  pages_total: number | null;
  checkpoint_validated: boolean;
  checkpoint_pages: number | null;
  current_page: number | null;
}

function count(value: unknown, min = 0): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= 10_000
  );
}

// Missing legacy metadata is not proof of admission or of reusable checkpoints.
// Ignore it without resetting the last confirmed progress or failing the file.
export function parserProgress(
  value: unknown,
  requestId: string,
  fingerprint: string,
): ParserProgress | null {
  if (
    !record(value) ||
    !UUID.test(requestId) ||
    !HASH.test(fingerprint) ||
    value.request_id !== requestId ||
    value.pipeline_fingerprint !== fingerprint ||
    !PARSER_STAGES.some((stage) => stage === value.stage) ||
    !count(value.pages_completed) ||
    !(
      value.pages_total === null ||
      (count(value.pages_total) && value.pages_total >= value.pages_completed)
    ) ||
    typeof value.checkpoint_validated !== "boolean" ||
    !(
      value.checkpoint_pages === null ||
      (count(value.checkpoint_pages) &&
        value.checkpoint_pages <= value.pages_completed)
    ) ||
    !(
      value.current_page === null ||
      (count(value.current_page, 1) &&
        (value.pages_total === null || value.current_page <= value.pages_total))
    ) ||
    (!value.checkpoint_validated && value.checkpoint_pages !== null) ||
    (["starting", "checkpoint_verifying"].includes(String(value.stage)) &&
      value.checkpoint_validated)
  )
    return null;
  return value as unknown as ParserProgress;
}
