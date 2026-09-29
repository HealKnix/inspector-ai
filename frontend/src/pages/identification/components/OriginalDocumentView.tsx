import { getParseResult } from "@/api/endpoints/parsing";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type {
  IdentificationEvidence,
  IdentificationRevision,
} from "@/api/types/identification";
import type { ParsingFile } from "@/api/types/parsing";
import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { RenderedDocumentPage } from "@/components/rendered-document-page/RenderedDocumentPage";
import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { OriginalPageTarget } from "../lib/sheet-review";

export function OriginalDocumentView({
  objectId,
  processId,
  runId,
  revision,
  filenames,
  evidence,
  pageTarget,
}: {
  objectId: string;
  processId: string;
  runId: string;
  revision: IdentificationRevision;
  filenames: Map<string, string>;
  evidence: IdentificationEvidence | null;
  pageTarget?: OriginalPageTarget | null;
}) {
  const [selectedFile, setSelectedFile] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const representation =
    revision.representations.find(
      (item) =>
        item.artifact_id ===
        (selectedFile || pageTarget?.artifact_id || evidence?.artifact_id),
    ) ??
    revision.representations.find(
      (item) => item.format.toUpperCase() === "PDF",
    ) ??
    revision.representations[0];
  const targetMatches =
    pageTarget &&
    representation &&
    pageTarget.file_id === representation.file_id &&
    pageTarget.artifact_id === representation.artifact_id &&
    pageTarget.source_sha256 === representation.source_sha256 &&
    pageTarget.artifact_sha256 === representation.artifact_sha256;
  const selectedPage = !selectedFile
    ? targetMatches
      ? pageTarget.page_number
      : (evidence?.page_number ?? pageNumber)
    : pageNumber;
  const query = useQuery({
    queryKey: queryKeys.objects.parse(
      objectId,
      representation?.file_id ?? "",
      runId,
      representation?.artifact_id ?? "",
    ),
    enabled: Boolean(representation),
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await getParseResult(
        objectId,
        representation!.file_id,
        runId,
        representation!.artifact_id,
        signal,
      );
      if (result.artifact.source_sha256 !== representation!.source_sha256)
        throw new ApiError("Источник не соответствует выбранному документу.", {
          status: 409,
        });
      return result;
    },
  });
  const result = query.isError ? undefined : query.data;
  // A sheet map points to a physical source page, never a fabricated text block.
  // A missing historical page must not silently open another page as its proof.
  const targetInvalid = Boolean(pageTarget && !selectedFile && !targetMatches);
  const page = targetInvalid
    ? undefined
    : result?.artifact.pages.find((item) => item.page_number === selectedPage);
  const shownEvidence =
    evidence?.artifact_id === representation?.artifact_id &&
    evidence?.page_number === page?.page_number
      ? evidence
      : null;
  const name =
    (representation && filenames.get(representation.file_id)) ||
    "Оригинал документа";
  const file: ParsingFile | null = representation
    ? {
        file_id: representation.file_id,
        artifact_id: representation.artifact_id,
        run_id: runId,
        process_id: processId,
        original_name: name,
        state: "succeeded",
        pages_total: representation.page_count,
        pages_completed: representation.page_count,
        attempt: 0,
        quality: result?.artifact.quality ?? null,
        reasons: [],
        error_code: null,
        can_retry: false,
      }
    : null;
  return (
    <section
      className="border-border bg-card min-w-0 overflow-hidden rounded-xl border lg:sticky lg:top-3"
      aria-label="Оригинал документа"
    >
      <div className="border-border space-y-3 border-b p-4">
        <h2 className="font-semibold">Оригинал документа</h2>
        {revision.representations.length > 1 ? (
          <IdentificationSelect
            label="Файл документа"
            value={representation?.artifact_id ?? ""}
            options={revision.representations.map((item) => ({
              id: item.artifact_id,
              label: filenames.get(item.file_id) ?? item.format.toUpperCase(),
            }))}
            onChange={(value) => {
              setSelectedFile(value);
              setPageNumber(1);
            }}
          />
        ) : (
          <p className="text-copy-muted truncate text-sm" title={name}>
            {name}
          </p>
        )}
        {result && result.artifact.pages.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={selectedPage <= 1}
              onPress={() => {
                setSelectedFile(representation!.artifact_id);
                setPageNumber(selectedPage - 1);
              }}
            >
              Назад
            </Button>
            <span className="text-copy-muted text-sm">
              Страница {page?.page_number} из {result.artifact.pages.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={selectedPage >= result.artifact.pages.length}
              onPress={() => {
                setSelectedFile(representation!.artifact_id);
                setPageNumber(selectedPage + 1);
              }}
            >
              Далее
            </Button>
          </div>
        ) : null}
      </div>
      {shownEvidence ? (
        <blockquote className="border-accent m-4 border-l-2 pl-3 text-sm">
          {shownEvidence.quote}
        </blockquote>
      ) : null}
      {query.isPending && representation ? (
        <p role="status" className="p-6 text-sm">
          Открываем документ…
        </p>
      ) : null}
      {query.error || !representation || targetInvalid || (result && !page) ? (
        <div className="space-y-3 p-6 text-sm">
          <p>
            Не удалось открыть сохранённую страницу. Реквизиты и сохранённые
            цитаты доступны ниже.
          </p>
          {representation ? (
            <Button
              size="sm"
              variant="outline"
              onPress={() => void query.refetch()}
            >
              Повторить
            </Button>
          ) : null}
        </div>
      ) : null}
      {page && file ? (
        <div className="bg-default/20 max-h-[70vh] overflow-auto p-2">
          <RenderedDocumentPage
            objectId={objectId}
            file={file}
            page={page}
            zoom="fit"
            selectedId={shownEvidence?.block_id ?? null}
            matchIds={new Set(shownEvidence ? [shownEvidence.block_id] : [])}
            onSelect={() => undefined}
          />
        </div>
      ) : null}
    </section>
  );
}
