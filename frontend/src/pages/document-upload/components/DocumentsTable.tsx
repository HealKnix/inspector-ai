import {
  Button,
  Checkbox,
  Chip,
  Label,
  Popover,
  SearchField,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";

import type {
  DocumentStage,
  UploadDocument,
  UploadDocumentFilter,
} from "@/pages/document-upload/types";

import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

interface DocumentsTableProps {
  documents: readonly UploadDocument[];
  filter: UploadDocumentFilter;
  needsReviewCount: number;
  onFilterChange: (filter: UploadDocumentFilter) => void;
  onQueryChange: (query: string) => void;
  onRemoveDocument: (documentId: string) => void;
  onSelectedIdsChange: (selectedIds: Set<string>) => void;
  query: string;
  selectedIds: ReadonlySet<string>;
  stageCounts: Record<DocumentStage, number>;
  totalFiles: number;
}

const stageLabels: Record<DocumentStage, string> = {
  ID: "ИД",
  PD: "ПД",
  RD: "РД",
};

const filterOptions = (
  totalFiles: number,
  stageCounts: Record<DocumentStage, number>,
  needsReviewCount: number,
) =>
  [
    { label: `Все ${totalFiles}`, value: "all" },
    { label: `ПД ${stageCounts.PD}`, value: "PD" },
    { label: `РД ${stageCounts.RD}`, value: "RD" },
    { label: `ИД ${stageCounts.ID}`, value: "ID" },
    {
      label: `Требуют уточнения ${needsReviewCount}`,
      value: "needs-review",
    },
  ] satisfies Array<{ label: string; value: UploadDocumentFilter }>;

function StageBadge({ stage }: Pick<UploadDocument, "stage">) {
  if (!stage) {
    return (
      <span className="bg-surface-high text-copy-muted inline-flex rounded-full px-2.5 py-1 text-xs font-semibold">
        —
      </span>
    );
  }

  const stageClasses: Record<DocumentStage, string> = {
    ID: "bg-orange-500/15 text-orange-500",
    PD: "bg-purple-500/15 text-purple-500",
    RD: "bg-emerald-500/15 text-emerald-500",
  };

  return (
    <span
      className={`inline-flex min-w-10 justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${stageClasses[stage]}`}
    >
      {stageLabels[stage]}
    </span>
  );
}

function MetadataBadge({
  metadataState,
}: Pick<UploadDocument, "metadataState">) {
  const isReady = metadataState === "ready";

  return (
    <Chip
      variant="soft"
      color={isReady ? "success" : "warning"}
      className={cn("ring-1", isReady ? "ring-success" : "ring-warning")}
    >
      <span
        className={cn(
          "bg-warning size-2 flex-none rounded-full",
          isReady && "bg-success",
        )}
      />
      <Chip.Label className="ml-1 text-nowrap">
        {isReady ? "Определено" : "Требует уточнения"}
      </Chip.Label>
    </Chip>
  );
}

function SelectionCheckbox({
  ariaLabel,
  isIndeterminate,
  isSelected,
  isDisabled = false,
  onChange,
}: {
  ariaLabel: string;
  isIndeterminate?: boolean;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (isSelected: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      isIndeterminate={isIndeterminate}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      slot="selection"
      variant="secondary"
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
}

function RowActions({
  document,
  onRemove,
}: {
  document: UploadDocument;
  onRemove: (documentId: string) => void;
}) {
  return (
    <Popover>
      <Button
        aria-label={`Действия с файлом ${document.name}`}
        className="size-8 min-w-8 rounded-lg"
        isIconOnly
        size="sm"
        variant="ghost"
      >
        <UploadIcon className="size-4" name="more" />
      </Button>
      <Popover.Content className="border-border bg-popover rounded-xl border p-1 shadow-xl">
        <Popover.Dialog className="p-0.5 outline-none">
          <Button
            className="w-full justify-start rounded-lg"
            onPress={() => onRemove(document.id)}
            size="sm"
            variant="danger-soft"
          >
            <UploadIcon className="size-4" name="trash" />
            Удалить из списка
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

export function DocumentsTable({
  documents,
  filter,
  needsReviewCount,
  onFilterChange,
  onQueryChange,
  onRemoveDocument,
  onSelectedIdsChange,
  query,
  selectedIds,
  stageCounts,
  totalFiles,
}: DocumentsTableProps) {
  const visibleIds = documents.map((document) => document.id);
  const selectedVisibleCount = visibleIds.filter((id) =>
    selectedIds.has(id),
  ).length;
  const isAllVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const isSelectionIndeterminate =
    selectedVisibleCount > 0 && !isAllVisibleSelected;

  const toggleAllVisible = (isSelected: boolean) => {
    const nextSelectedIds = new Set(selectedIds);
    visibleIds.forEach((id) => {
      if (isSelected) nextSelectedIds.add(id);
      else nextSelectedIds.delete(id);
    });
    onSelectedIdsChange(nextSelectedIds);
  };

  const toggleDocument = (documentId: string, isSelected: boolean) => {
    const nextSelectedIds = new Set(selectedIds);
    if (isSelected) nextSelectedIds.add(documentId);
    else nextSelectedIds.delete(documentId);
    onSelectedIdsChange(nextSelectedIds);
  };

  const handleFilterChange = (keys: Set<Key>) => {
    const selectedFilter = keys.values().next().value;
    if (
      selectedFilter === "all" ||
      selectedFilter === "PD" ||
      selectedFilter === "RD" ||
      selectedFilter === "ID" ||
      selectedFilter === "needs-review"
    ) {
      onFilterChange(selectedFilter);
    }
  };

  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border shadow-sm"
      id="uploaded-documents"
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 min-[1120px]:flex-row min-[1120px]:items-center sm:px-5">
        <h2 className="mr-auto text-lg font-semibold">
          Загруженные документы ({totalFiles})
        </h2>
        <SearchField
          className="w-full min-[1120px]:max-w-72"
          onChange={onQueryChange}
          value={query}
        >
          <Label className="sr-only">Поиск по документам</Label>
          <SearchField.Group className="rounded-xl">
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Поиск по файлам…" type="search" />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
      </div>

      <div className="overflow-x-auto px-4 pb-3 sm:px-5">
        <ToggleButtonGroup
          aria-label="Фильтр документов"
          className="w-max gap-1"
          disallowEmptySelection
          isDetached
          onSelectionChange={handleFilterChange}
          selectedKeys={new Set<Key>([filter])}
          selectionMode="single"
          size="sm"
        >
          {filterOptions(totalFiles, stageCounts, needsReviewCount).map(
            (option) => (
              <ToggleButton
                className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
                id={option.value}
                key={option.value}
                variant="ghost"
              >
                {option.label}
              </ToggleButton>
            ),
          )}
        </ToggleButtonGroup>
      </div>

      <div className="hidden min-[981px]:block">
        <Table className="rounded-none border-0 shadow-none">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Загруженные документы"
              className="min-w-[900px]"
            >
              <Table.Header>
                <Table.Column className="w-12 px-4">
                  <SelectionCheckbox
                    ariaLabel="Выбрать все видимые документы"
                    isIndeterminate={isSelectionIndeterminate}
                    isSelected={isAllVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </Table.Column>
                <Table.Column isRowHeader>Файл</Table.Column>
                <Table.Column>Стадия</Table.Column>
                <Table.Column>Раздел</Table.Column>
                <Table.Column>Шифр</Table.Column>
                <Table.Column>Редакция</Table.Column>
                <Table.Column>Статус</Table.Column>
                <Table.Column aria-label="Действия" className="w-14" />
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="text-copy-muted flex min-h-48 items-center justify-center text-sm">
                    Документы не найдены
                  </div>
                )}
              >
                {documents.map((document) => (
                  <Table.Row
                    key={document.id}
                    className="has-[input:checked]:[&_td]:bg-accent/5 has-[input:checked]:[&_td]:text-accent"
                  >
                    <Table.Cell className="px-4">
                      <SelectionCheckbox
                        ariaLabel={`Выбрать ${document.name}`}
                        isSelected={selectedIds.has(document.id)}
                        onChange={(isSelected) =>
                          toggleDocument(document.id, isSelected)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex min-w-0 items-center gap-3">
                        <UploadIcon name={document.extension} />
                        <span className="max-w-[280px] truncate text-sm font-medium">
                          {document.name}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <StageBadge stage={document.stage} />
                    </Table.Cell>
                    <Table.Cell className="text-copy-muted text-sm">
                      {document.section ?? "—"}
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      {document.cipher ?? "—"}
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      {document.revision ?? "—"}
                    </Table.Cell>
                    <Table.Cell>
                      <MetadataBadge metadataState={document.metadataState} />
                    </Table.Cell>
                    <Table.Cell>
                      <RowActions
                        document={document}
                        onRemove={onRemoveDocument}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <div className="divide-border border-border divide-y border-t min-[981px]:hidden">
        {documents.length === 0 ? (
          <p className="text-copy-muted px-5 py-12 text-center text-sm">
            Документы не найдены
          </p>
        ) : (
          documents.map((document) => (
            <article
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3"
              key={document.id}
            >
              <div className="flex flex-col items-center gap-2">
                <SelectionCheckbox
                  ariaLabel={`Выбрать ${document.name}`}
                  isSelected={selectedIds.has(document.id)}
                  onChange={(isSelected) =>
                    toggleDocument(document.id, isSelected)
                  }
                />
                <UploadIcon name={document.extension} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{document.name}</p>
                <p className="text-copy-muted mt-1 truncate text-xs">
                  {document.cipher ?? "Шифр не определён"}
                  {document.revision ? ` · ${document.revision}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StageBadge stage={document.stage} />
                  <span className="text-copy-muted text-xs">
                    {document.section ?? "Раздел не определён"}
                  </span>
                  <MetadataBadge metadataState={document.metadataState} />
                </div>
              </div>
              <RowActions document={document} onRemove={onRemoveDocument} />
            </article>
          ))
        )}
      </div>
    </section>
  );
}
