import type { IdentificationRegistry } from "@/api/types/identification";
import {
  parsedFile,
  parseResult,
  parsingObjectId,
} from "@/api/types/parsing-test-fixtures";

// Explicit synthetic fixture; never imported by product code.
export const idRegistry: IdentificationRegistry = {
  schema_version: 1,
  object_id: parsingObjectId,
  process_id: parsedFile.process_id,
  process_status: "PENDING",
  current_run_id: parsedFile.run_id,
  run_id: parsedFile.run_id,
  current: true,
  active: false,
  allowed_actions: { apply: true },
  resolved_input_hash: "c".repeat(64),
  blockers: [],
  contexts: [],
  documents: [
    {
      document_id: "11111111-1111-4111-8111-111111111111",
      card_version: 1,
      revisions: [
        {
          revision_id: "22222222-2222-4222-8222-222222222222",
          fields: {
            stage: "ID",
            kind_code: "AOSR",
            number: "52",
            title: "Синтетический АОСР №52",
          },
          candidates: [
            {
              candidate_id: "own-number",
              field: "number",
              raw: "52",
              normalized: "52",
              role: "own",
              method: "rules",
              engine_version: "test-v1",
              evidence: [
                {
                  file_id: parsedFile.file_id,
                  artifact_id: parsedFile.artifact_id!,
                  artifact_sha256: "a".repeat(64),
                  source_sha256: parseResult.artifact.source_sha256,
                  page_number: 1,
                  block_id: parseResult.artifact.pages[0]!.blocks[0]!.id,
                  quote: "Синтетический акт №52",
                  bbox: [0, 0, 1, 1],
                  structural_path: "/synthetic/act/number",
                },
              ],
            },
          ],
          representations: [
            {
              file_id: parsedFile.file_id,
              artifact_id: parsedFile.artifact_id!,
              artifact_sha256: "a".repeat(64),
              source_sha256: parseResult.artifact.source_sha256,
              format: "XML",
              page_count: 1,
            },
          ],
          approval: {
            confirmed: false,
            effective_from: null,
            effective_to: null,
            replaces_revision_id: null,
            basis: null,
          },
          blockers: [],
          reference_revision_id: null,
        },
      ],
    },
  ],
};
