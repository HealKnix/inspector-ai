import { Button } from "@heroui/react";

import { UploadIcon } from "./UploadIcon";

interface MetadataAssistantProps {
  needsReviewCount: number;
  onReview: () => void;
}

export function MetadataAssistant({
  needsReviewCount,
  onReview,
}: MetadataAssistantProps) {
  return (
    <section className="border-border bg-card flex flex-col rounded-[20px] border p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="bg-accent/10 text-accent grid size-11 shrink-0 place-items-center rounded-full">
          <UploadIcon className="size-5.5" name="sparkles" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">ИИ-помощник</h2>
            <span className="bg-accent/10 text-accent rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide">
              БЕТА
            </span>
          </div>
          <p className="mt-2 text-lg leading-6 font-semibold">
            {needsReviewCount} требуют уточнения метаданных
          </p>
        </div>
      </div>

      <p className="text-copy-muted mt-4 text-sm leading-6">
        Система не смогла однозначно определить стадию, раздел, шифр или
        редакцию для части документов.
      </p>

      <div className="bg-accent/5 mt-4 rounded-[14px] p-4 text-sm">
        <p className="font-medium">Рекомендуем:</p>
        <ul className="text-copy-muted mt-2 list-disc space-y-1.5 pl-4 leading-5">
          <li>Проверить найденные стадию и раздел</li>
          <li>Уточнить редакцию и признак утверждения</li>
          <li>Связать предыдущую и следующую версии</li>
        </ul>
      </div>

      <Button
        className="mt-4 w-full rounded-xl"
        isDisabled={needsReviewCount === 0}
        onPress={onReview}
      >
        <UploadIcon className="size-4.5" name="play" />
        Разобрать ({needsReviewCount})
      </Button>
    </section>
  );
}
