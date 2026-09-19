import { Button } from "@heroui/react";
import { useState } from "react";

import {
  classificationErrorMessage,
  useRetryClassification,
} from "@/api/hooks/use-classification";
import type { ClassificationFile } from "@/api/types/classification";

export function RetryClassificationButton({
  objectId,
  file,
}: {
  objectId: string;
  file: ClassificationFile;
}) {
  const retry = useRetryClassification();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  if (!file.can_retry) return null;
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        className="rounded-xl"
        isDisabled={retry.isPending}
        isPending={retry.isPending}
        aria-label={`Повторить классификацию: ${file.original_name}`}
        onPress={() =>
          retry.mutate(
            { objectId, fileId: file.file_id, requestId },
            { onSuccess: () => setRequestId(crypto.randomUUID()) },
          )
        }
      >
        Повторить классификацию
      </Button>
      <p className="text-copy-muted text-xs">По сохранённому тексту</p>
      {retry.isSuccess && (
        <p role="status" className="text-copy-muted text-xs">
          Запрос классификации принят.
        </p>
      )}
      {retry.error && (
        <p role="alert" className="text-danger max-w-lg text-xs leading-5">
          {classificationErrorMessage(retry.error)} Повторное нажатие уточнит
          этот же запрос.
        </p>
      )}
    </div>
  );
}
