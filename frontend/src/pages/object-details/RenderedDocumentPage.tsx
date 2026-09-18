import { useEffect, useRef } from "react";

import { parsingErrorMessage, useRenderedPage } from "@/api/hooks/use-parsing";
import type { ParsingFile, RenderedPage, TextBlock } from "@/api/types/parsing";
import { isVisibleDocumentBlock } from "./document-blocks";
import { regionKindLabels } from "./region-labels";

function ProtectedPageImage({
  blob,
  page,
  name,
}: {
  blob: Blob;
  page: RenderedPage;
  name: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return (
    <img
      ref={imageRef}
      alt={`Страница ${page.page_number} документа ${name}`}
      className="block h-auto w-full"
      width={page.width}
      height={page.height}
    />
  );
}

function blockRectangle(bbox: TextBlock["bbox"]) {
  const [x0, y0, x1, y1] = bbox;
  return {
    left: `${x0 * 100}%`,
    top: `${y0 * 100}%`,
    width: `${(x1 - x0) * 100}%`,
    height: `${(y1 - y0) * 100}%`,
  };
}

export function RenderedDocumentPage({
  objectId,
  file,
  page,
  zoom,
  selectedId,
  matchIds,
  onSelect,
  showRegions = false,
  selectedRegionId = null,
  onRegionSelect,
}: {
  objectId: string;
  file: ParsingFile;
  page: RenderedPage;
  zoom: number | "fit";
  selectedId: string | null;
  matchIds: Set<string>;
  onSelect: (id: string) => void;
  showRegions?: boolean;
  selectedRegionId?: string | null;
  onRegionSelect?: (id: string) => void;
}) {
  const query = useRenderedPage(objectId, file, page.page_number);
  const blob = query.isError ? undefined : query.data;
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({
      block: "center",
      inline: "center",
    });
  }, [selectedId, selectedRegionId, showRegions, zoom, blob]);

  return (
    <div className="bg-surface-high max-h-[70vh] min-h-72 min-w-0 overflow-auto rounded-xl p-3 sm:p-5">
      {query.isPending && (
        <p role="status" className="text-copy-muted py-16 text-center text-sm">
          Загружаем страницу…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-danger p-5 text-sm">
          {parsingErrorMessage(query.error)}
        </p>
      )}
      {blob && (
        <div
          className="relative mx-auto bg-white shadow-sm"
          style={{
            width: zoom === "fit" ? "100%" : page.width * zoom,
            maxWidth: zoom === "fit" ? page.width : undefined,
          }}
        >
          <ProtectedPageImage
            blob={blob}
            page={page}
            name={file.original_name}
          />
          {showRegions &&
            page.regions?.map((region, index) => (
              <button
                key={region.id}
                type="button"
                ref={selectedRegionId === region.id ? selectedRef : undefined}
                aria-label={`Область ${index + 1}: ${regionKindLabels[region.kind]}`}
                aria-pressed={selectedRegionId === region.id}
                onClick={() => onRegionSelect?.(region.id)}
                className={`group absolute cursor-pointer border-2 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selectedRegionId === region.id ? "z-10 border-blue-700 bg-blue-500/20" : region.kind === "unknown" ? "border-dashed border-amber-600/30 hover:border-amber-600 hover:bg-amber-300/20 focus-visible:border-amber-600" : region.kind === "graphic" ? "border-violet-600 hover:bg-violet-300/20" : "border-emerald-600 hover:bg-emerald-300/20"}`}
                style={blockRectangle(region.bbox)}
              >
                <span
                  className={`absolute top-0 left-0 bg-white/95 px-1 text-[10px] font-semibold text-black ${region.kind === "unknown" && selectedRegionId !== region.id ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`}
                >
                  {index + 1}
                </span>
              </button>
            ))}
          {!showRegions &&
            page.blocks
              .filter(isVisibleDocumentBlock)
              .map((block) => (
                <button
                  key={block.id}
                  ref={selectedId === block.id ? selectedRef : undefined}
                  type="button"
                  aria-label={`Фрагмент ${block.order + 1}: ${block.normalized_text.slice(0, 100)}`}
                  aria-pressed={selectedId === block.id}
                  onClick={() => onSelect(block.id)}
                  className={`absolute cursor-pointer border transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selectedId === block.id ? "border-blue-700 bg-blue-500/25" : matchIds.has(block.id) ? "border-amber-600 bg-amber-300/35" : "border-transparent hover:border-blue-600 hover:bg-blue-500/15"}`}
                  style={blockRectangle(block.bbox)}
                />
              ))}
        </div>
      )}
    </div>
  );
}
