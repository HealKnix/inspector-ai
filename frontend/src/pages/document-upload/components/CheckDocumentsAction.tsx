import { Button } from "@heroui/react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/errors";
import { useExtractions } from "@/api/hooks/use-extraction";
import { useVerificationMutations } from "@/api/hooks/use-verification";
import type { IdentificationRegistry } from "@/api/types/identification";
import { UploadIcon } from "@/components/UploadIcon";
import routeNames from "@/routes/routeNames";

export function CheckDocumentsAction({
  objectId,
  registry,
  preparing,
  unavailable,
}: {
  objectId: string;
  registry?: IdentificationRegistry;
  preparing: boolean;
  unavailable: boolean;
}) {
  const navigate = useNavigate();
  const extraction = useExtractions(
    objectId,
    preparing,
    Boolean(registry),
    registry?.resolved_input_hash,
  );
  const { generate } = useVerificationMutations(objectId);
  const finalized = registry?.process_status === "FINALIZED";
  const busy = preparing || registry?.active || extraction.data?.active;
  const disabled =
    unavailable ||
    !registry?.current ||
    !registry.resolved_input_hash ||
    (!finalized &&
      (!registry.allowed_actions.apply ||
        extraction.isPending ||
        extraction.isError ||
        busy));
  const error =
    generate.error instanceof ApiError && generate.error.status === 409
      ? "Документы изменились или ещё обрабатываются. Обновите страницу и повторите проверку."
      : generate.error
        ? "Не удалось подготовить проверку. Повторите попытку."
        : null;
  const openResults = () =>
    void navigate(routeNames.DOCUMENT_VERIFICATION_DETAILS(objectId));
  const checkDocuments = () => {
    if (finalized) {
      openResults();
      return;
    }
    generate.mutate(undefined, { onSuccess: openResults });
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
      {error ? (
        <p role="alert" className="text-danger max-w-md text-xs">
          {error}
        </p>
      ) : null}
      {extraction.isError ? (
        <p role="alert" className="text-danger max-w-md text-xs">
          Не удалось проверить готовность документов. Обновите страницу.
        </p>
      ) : null}
      <Button
        className="rounded-xl"
        isDisabled={Boolean(disabled || generate.isPending)}
        isPending={generate.isPending}
        onPress={checkDocuments}
      >
        <UploadIcon className="size-4.5" name="play" />
        {finalized
          ? "Открыть проверку"
          : busy
            ? "Документы обрабатываются…"
            : "Проверить документы"}
      </Button>
    </div>
  );
}
