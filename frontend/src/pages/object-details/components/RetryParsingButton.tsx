import { Button } from "@heroui/react";
import { useState } from "react";

import { parsingErrorMessage, useRetryParsing } from "@/api/hooks/use-parsing";
import type { ParsingFile } from "@/api/types/parsing";

export function RetryParsingButton({
  objectId,
  file,
}: {
  objectId: string;
  file: ParsingFile;
}) {
  const retry = useRetryParsing();
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
        onPress={() =>
          retry.mutate(
            { objectId, fileId: file.file_id, requestId },
            {
              onSuccess: () => setRequestId(crypto.randomUUID()),
            },
          )
        }
      >
        Повторить обработку
      </Button>
      {retry.isSuccess && (
        <p role="status" className="text-copy-muted text-xs">
          Повторная обработка принята.
        </p>
      )}
      {retry.error && (
        <p role="alert" className="text-danger max-w-lg text-xs leading-5">
          {parsingErrorMessage(retry.error)} Повторное нажатие уточнит этот же
          запрос.
        </p>
      )}
    </div>
  );
}
