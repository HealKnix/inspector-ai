import { Button, Input } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

import { parsingErrorMessage, useParseResult } from "@/api/hooks/use-parsing";
import type { ParseResult, ParsingFile } from "@/api/types/parsing";
import { isVisibleDocumentBlock } from "@/components/rendered-document-page/document-blocks";
import { RenderedDocumentPage } from "@/components/rendered-document-page/RenderedDocumentPage";

import { qualityLabels, qualityReasonLabel } from "../lib/parsing-labels";
import { TextBlocksPanel, type TextView } from "./TextBlocksPanel";

export interface DocumentViewState {
  view: TextView;
  mode: "normalized_text" | "raw_text";
  blockId: string | null;
  regionId: string | null;
}
const defaultDocumentViewState: DocumentViewState = {
  view: "fragments",
  mode: "normalized_text",
  blockId: null,
  regionId: null,
};

export function DocumentViewer({
  objectId,
  file,
  sourceFormat,
  sourceHash,
  pageNumber,
  onPage,
  onClose,
  viewState,
  onNavigate,
}: {
  objectId: string;
  file: ParsingFile;
  sourceFormat?: string;
  sourceHash?: string;
  pageNumber: number;
  onPage: (page: number) => void;
  onClose: () => void;
  viewState?: DocumentViewState;
  onNavigate?: (page: number, state: DocumentViewState) => void;
}) {
  const viewerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    viewerRef.current?.focus({ preventScroll: true });
    viewerRef.current?.scrollIntoView?.({ block: "start" });
  }, []);
  const query = useParseResult(objectId, file);
  const result = query.isError ? undefined : query.data;
  const wrongSource = Boolean(
    result && sourceHash && result.artifact.source_sha256 !== sourceHash,
  );

  return (
    <section
      ref={viewerRef}
      tabIndex={-1}
      id="document-viewer"
      className="border-border bg-card min-w-0 rounded-[20px] border p-4 sm:p-5"
      aria-labelledby="viewer-title"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="viewer-title" className="text-lg font-semibold break-words">
            {file.original_name}
          </h2>
          <p className="text-copy-muted mt-1 text-xs leading-5">
            {sourceFormat === "PDF"
              ? "Страницы оригинала и извлечённый текст"
              : "Представление содержимого и извлечённый текст"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onPress={onClose}
          aria-label="Закрыть просмотр документа"
        >
          Закрыть
        </Button>
      </div>
      {query.isPending && (
        <p role="status" className="text-copy-muted py-10 text-sm">
          Загружаем результат обработки…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-danger py-5 text-sm">
          {parsingErrorMessage(query.error)}
        </p>
      )}
      {wrongSource && (
        <p role="alert" className="text-danger py-5 text-sm">
          Результат не соответствует оригиналу. Обновите состояние документов.
        </p>
      )}
      {result && !wrongSource && (
        <DocumentContent
          key={result.artifact_id}
          objectId={objectId}
          file={file}
          result={result}
          pageNumber={pageNumber}
          onPage={onPage}
          viewState={viewState}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}

function DocumentContent({
  objectId,
  file,
  result,
  pageNumber,
  onPage,
  viewState,
  onNavigate,
}: {
  objectId: string;
  file: ParsingFile;
  result: ParseResult;
  pageNumber: number;
  onPage: (page: number) => void;
  viewState?: DocumentViewState;
  onNavigate?: (page: number, state: DocumentViewState) => void;
}) {
  const { artifact } = result;
  const [search, setSearch] = useState("");
  const [localState, setLocalState] = useState(defaultDocumentViewState);
  const state = viewState ?? localState;
  const { view: textView, mode } = state;
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const page =
    artifact.pages.find((item) => item.page_number === pageNumber) ??
    artifact.pages[0];
  const term = search.trim().normalize("NFC").toLocaleLowerCase("ru-RU");
  const matches = term
    ? artifact.pages.flatMap((item) =>
        item.blocks
          .filter(isVisibleDocumentBlock)
          .filter((block) =>
            block[mode]
              .normalize("NFC")
              .toLocaleLowerCase("ru-RU")
              .includes(term),
          )
          .map((block) => ({ page: item.page_number, block })),
      )
    : [];
  const selectedId = page?.blocks.some((block) => block.id === state.blockId)
    ? state.blockId
    : null;
  const selectedRegionId = page?.regions?.some(
    (region) => region.id === state.regionId,
  )
    ? state.regionId
    : null;
  const matchIndex = matches.findIndex(
    (match) =>
      match.page === page?.page_number && match.block.id === selectedId,
  );

  function selectMatch(index: number) {
    const match = matches[index];
    if (!match) return;
    navigate(match.page, {
      view: "fragments",
      blockId: match.block.id,
      regionId: null,
    });
  }

  function navigate(nextPage: number, patch: Partial<DocumentViewState>) {
    const next = { ...state, ...patch };
    if (onNavigate) onNavigate(nextPage, next);
    else {
      setLocalState(next);
      onPage(nextPage);
    }
  }

  if (!page)
    return (
      <p className="text-copy-muted py-6 text-sm">
        Страницы для просмотра отсутствуют. {qualityLabels[artifact.quality]}
      </p>
    );

  return (
    <div className="space-y-4">
      <div className="bg-surface-high rounded-xl px-4 py-3 text-sm leading-6">
        <p
          className={
            artifact.quality === "OK" ? "text-copy-muted" : "text-warning"
          }
        >
          {artifact.region_schema_version === 1
            ? artifact.quality === "OK"
              ? "Обработка областей завершена"
              : "Часть областей требует проверки"
            : qualityLabels[artifact.quality]}
        </p>
        <p className="text-copy-muted">
          Страниц с прочитанным текстом: {artifact.coverage.readable_pages} из{" "}
          {artifact.coverage.total_pages}; без читаемого текста:{" "}
          {artifact.coverage.unreadable_pages}.
        </p>
        {artifact.region_schema_version === 1 &&
          artifact.reasons.length > 0 && (
            <details className="text-copy-muted mt-2 text-xs leading-5">
              <summary className="cursor-pointer">
                Ограничения обработки документа
              </summary>
              <p className="mt-1">
                Выберите область, чтобы увидеть причину ограничения и
                сохранённые данные.
              </p>
              <ul>
                {artifact.reasons.map((reason, index) => (
                  <li key={`${index}:${reason}`}>
                    {qualityReasonLabel(reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        {artifact.region_schema_version !== 1 &&
          artifact.reasons.length > 0 && (
            <ul className="text-copy-muted mt-1 text-xs">
              {artifact.reasons.map((reason, index) => (
                <li key={`${index}:${reason}`}>{qualityReasonLabel(reason)}</li>
              ))}
            </ul>
          )}
        <p className="text-copy-muted mt-1 text-xs">
          Качество относится к распознаванию, а не к соответствию документа
          требованиям.
        </p>
        {artifact.region_schema_version !== 1 && (
          <p className="text-copy-muted mt-1 text-xs">
            Разметка областей для этого результата не выполнялась.
          </p>
        )}
        {artifact.region_schema_version === 1 && (
          <p className="text-copy-muted mt-1 text-xs">
            Текст и таблицы обработаны по областям. Графика и неопределённые
            области сохранены без OCR; их содержимое не считается проверенным.
          </p>
        )}
        <p className="text-copy-muted mt-1 text-xs">
          Движок распознавания:{" "}
          {artifact.versions.ocr_engine || "не указан в результате"}
          {artifact.versions.paddleocr &&
            ` · PaddleOCR ${artifact.versions.paddleocr}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          isDisabled={page.page_number <= 1}
          onPress={() =>
            navigate(page.page_number - 1, { blockId: null, regionId: null })
          }
          aria-label="Предыдущая страница"
        >
          ←
        </Button>
        <span className="text-copy-muted px-1 text-sm">
          Страница {page.page_number} из {artifact.pages.length}
          {page.sheet_label && ` · лист ${page.sheet_label}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          isDisabled={page.page_number >= artifact.pages.length}
          onPress={() =>
            navigate(page.page_number + 1, { blockId: null, regionId: null })
          }
          aria-label="Следующая страница"
        >
          →
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            isDisabled={typeof zoom === "number" && zoom <= 0.25}
            onPress={() =>
              setZoom(Math.max(0.25, (zoom === "fit" ? 1 : zoom) - 0.25))
            }
            aria-label="Уменьшить масштаб"
          >
            −
          </Button>
          <span className="text-copy-muted min-w-12 text-center text-xs">
            {zoom === "fit" ? "По ширине" : `${Math.round(zoom * 100)}%`}
          </span>
          <Button
            size="sm"
            variant="outline"
            isDisabled={typeof zoom === "number" && zoom >= 3}
            onPress={() =>
              setZoom(Math.min(3, (zoom === "fit" ? 1 : zoom) + 0.25))
            }
            aria-label="Увеличить масштаб"
          >
            +
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setZoom("fit")}>
            По ширине
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Поиск по тексту документа"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Найти текст в основных фрагментах"
          className="min-w-40 flex-1"
        />
        {term && (
          <>
            <span role="status" className="text-copy-muted text-xs">
              {matches.length
                ? `Фрагментов: ${matches.length}`
                : "Совпадений нет"}
            </span>
            <Button
              size="sm"
              variant="outline"
              isDisabled={!matches.length}
              onPress={() =>
                selectMatch((matchIndex - 1 + matches.length) % matches.length)
              }
              aria-label="Предыдущее совпадение"
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="outline"
              isDisabled={!matches.length}
              onPress={() => selectMatch((matchIndex + 1) % matches.length)}
              aria-label="Следующее совпадение"
            >
              ↓
            </Button>
          </>
        )}
      </div>
      {artifact.region_schema_version === 1 && (
        <p className="text-copy-muted text-xs">
          Поиск выполняется по основным фрагментам. Исключённые надписи доступны
          в областях и полном тексте.
        </p>
      )}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <div className="min-w-0 space-y-3">
          {artifact.region_schema_version === 1 && page.reasons.length > 0 && (
            <details className="text-copy-muted text-xs leading-5">
              <summary className="cursor-pointer">
                Ограничения страницы {page.page_number}
              </summary>
              {page.reasons.map((reason, index) => (
                <p key={`${index}:${reason}`}>{qualityReasonLabel(reason)}</p>
              ))}
            </details>
          )}
          {artifact.region_schema_version !== 1 && page.quality !== "OK" && (
            <div className="text-warning text-xs leading-5">
              <p>{qualityLabels[page.quality]}</p>
              {page.reasons.map((reason, index) => (
                <p key={`${index}:${reason}`}>{qualityReasonLabel(reason)}</p>
              ))}
            </div>
          )}
          <RenderedDocumentPage
            key={`${result.artifact_id}:${page.page_number}`}
            objectId={objectId}
            file={file}
            page={page}
            zoom={zoom}
            selectedId={selectedId ?? null}
            matchIds={
              new Set(
                matches
                  .filter((match) => match.page === page.page_number)
                  .map((match) => match.block.id),
              )
            }
            onSelect={(id) => {
              navigate(page.page_number, {
                blockId: id,
                view: "fragments",
                regionId: null,
              });
            }}
            showRegions={textView === "regions"}
            selectedRegionId={selectedRegionId}
            onRegionSelect={(id) =>
              navigate(page.page_number, {
                regionId: id,
                blockId: null,
                view: "regions",
              })
            }
          />
        </div>
        <TextBlocksPanel
          blocks={page.blocks}
          pages={artifact.pages}
          fullText={artifact[mode]}
          view={textView}
          onView={(view) => navigate(page.page_number, { view })}
          selectedId={selectedId ?? null}
          mode={mode}
          onMode={(mode) => navigate(page.page_number, { mode })}
          onSelect={(id) =>
            navigate(page.page_number, {
              blockId: id,
              view: "fragments",
              regionId: null,
            })
          }
          onTableSelect={(selectedPage, id) => {
            navigate(selectedPage, { blockId: id, regionId: null });
          }}
          page={page}
          selectedRegionId={selectedRegionId}
          onRegionSelect={(id) =>
            navigate(page.page_number, { regionId: id, blockId: null })
          }
          onTableRegionSelect={(selectedPage, id) =>
            navigate(selectedPage, {
              regionId: id,
              blockId: null,
              view: "regions",
            })
          }
        />
      </div>
    </div>
  );
}
