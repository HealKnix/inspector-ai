import { Button } from "@heroui/react";

import { UploadIcon } from "@/components/UploadIcon";

interface MetadataAssistantProps {
  needsReviewCount: number;
  onOpen?: () => void;
}

export function MetadataAssistant({
  needsReviewCount,
  onOpen,
}: MetadataAssistantProps) {
  return (
    <section className="border-border bg-card flex flex-col rounded-[20px] border p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="font-semibold">Сведения о документах</h2>
          <p className="mt-2 text-lg leading-6 font-semibold">
            {needsReviewCount > 0
              ? `Нужно проверить: ${needsReviewCount}`
              : "Документы можно проверить"}
          </p>
        </div>
      </div>

      <p className="text-copy-muted mt-4 text-sm leading-6">
        {needsReviewCount > 0
          ? "Откройте отмеченные документы и проверьте указанные вопросы."
          : "Система подготовит результаты по всему комплекту. Сведения можно уточнить в карточке документа."}
      </p>

      <Button
        className="mt-4 w-full rounded-xl"
        isDisabled={!onOpen}
        onPress={onOpen}
        variant="outline"
      >
        <UploadIcon className="size-4.5" name="play" />
        {needsReviewCount > 0 ? "Уточнить сведения" : "Открыть документы"}
      </Button>
    </section>
  );
}
