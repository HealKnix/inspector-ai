import type {
  IdentificationEvidence,
  IdentificationRevision,
} from "@/api/types/identification";
import { Button } from "@heroui/react";
import { identificationFieldLabels } from "../lib/identification";

const roleLabels = {
  own: "Собственный реквизит",
  reference: "Ссылка на другой документ",
  observed: "Наблюдение из источника",
};
export function FieldCandidates({
  revision,
  onEvidence,
}: {
  revision: IdentificationRevision;
  onEvidence: (evidence: IdentificationEvidence) => void;
}) {
  return (
    <section aria-label="Распознанные кандидаты" className="space-y-3">
      <h3 className="font-semibold">Кандидаты и доказательства</h3>
      {revision.candidates.length ? (
        <ul className="space-y-3">
          {revision.candidates.map((candidate) => (
            <li
              key={candidate.candidate_id}
              className="border-border rounded-xl border p-3"
            >
              <p className="text-copy-muted text-xs">
                {roleLabels[candidate.role]} ·{" "}
                {identificationFieldLabels[candidate.field]}
              </p>
              <p className="mt-1 text-sm break-words">
                {candidate.normalized ?? "Значение не определено"}
              </p>
              <p className="text-copy-muted mt-1 text-xs break-words">
                В источнике: {candidate.raw}
              </p>
              {candidate.method === "llm" ? (
                <p className="text-warning mt-1 text-xs">
                  Предложение модели требует проверки.
                </p>
              ) : null}
              {candidate.evidence.map((evidence, index) => (
                <Button
                  key={`${evidence.artifact_id}:${evidence.block_id}:${index}`}
                  variant="ghost"
                  size="sm"
                  onPress={() => onEvidence(evidence)}
                >
                  Открыть источник · стр. {evidence.page_number}
                </Button>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-copy-muted text-sm">
          Машинные кандидаты не найдены.
        </p>
      )}
    </section>
  );
}
