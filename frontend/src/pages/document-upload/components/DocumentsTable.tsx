import {
  Button,
  Checkbox,
  Label,
  Popover,
  SearchField,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  type Key,
} from "@heroui/react";

import {
  DocumentStage,
  UploadDocumentFilter,
  UploadRetryKind,
  UploadRowOrigin,
  UploadRowStatus,
  type UploadRow,
} from "@/pages/document-upload/types";

import { UploadIcon } from "@/components/UploadIcon";

interface DocumentsTableProps {
  failedCount: number;
  filter: UploadDocumentFilter;
  needsReviewCount: number;
  onAcceptDetectedStage: (fileId: string, stage: DocumentStage) => void;
  onChangeDeclaredStage: (clientFileId: string, stage: DocumentStage) => void;
  onDownload: (row: UploadRow) => void;
  onFilterChange: (filter: UploadDocumentFilter) => void;
  onQueryChange: (query: string) => void;
  onRemovePending: (clientFileId: string) => void;
  onRetry: (row: UploadRow) => void;
  onSelectedIdsChange: (selectedIds: Set<string>) => void;
  query: string;
  rows: readonly UploadRow[];
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
  failedCount: number,
) =>
  [
    { label: `Все ${totalFiles}`, value: UploadDocumentFilter.ALL },
    { label: `ПД ${stageCounts.PD}`, value: DocumentStage.PD },
    { label: `РД ${stageCounts.RD}`, value: DocumentStage.RD },
    { label: `ИД ${stageCounts.ID}`, value: DocumentStage.ID },
    {
      label: `Требуют уточнения ${needsReviewCount}`,
      value: UploadDocumentFilter.NEEDS_REVIEW,
    },
    {
      label: `Ошибки ${failedCount}`,
      value: UploadDocumentFilter.FAILED,
    },
  ] satisfies Array<{ label: string; value: UploadDocumentFilter }>;

function StageBadge({ stage }: { stage: DocumentStage | null }) {
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

const statusPresentation: Record<
  UploadRowStatus,
  { className: string; label: string }
> = {
  [UploadRowStatus.PENDING]: {
    className: "bg-surface-high text-copy-muted",
    label: "В пакете",
  },
  [UploadRowStatus.UPLOADING]: {
    className: "bg-accent/10 text-accent",
    label: "Передача…",
  },
  [UploadRowStatus.REJECTED]: {
    className: "bg-danger/10 text-danger",
    label: "Отклонён",
  },
  [UploadRowStatus.DUPLICATE]: {
    className: "bg-surface-high text-copy-muted",
    label: "Уже загружен",
  },
  [UploadRowStatus.ACCEPTED]: {
    className: "bg-accent/10 text-accent",
    label: "Принят",
  },
  [UploadRowStatus.QUEUED]: {
    className: "bg-surface-high text-copy-muted",
    label: "В очереди",
  },
  [UploadRowStatus.PROCESSING]: {
    className: "bg-accent/10 text-accent",
    label: "Обрабатывается",
  },
  [UploadRowStatus.CLASSIFYING]: {
    className: "bg-accent/10 text-accent",
    label: "Определение стадии…",
  },
  [UploadRowStatus.READY]: {
    className: "bg-success/10 text-foreground",
    label: "Определено",
  },
  [UploadRowStatus.NEEDS_REVIEW]: {
    className: "bg-warning/10 text-foreground",
    label: "Требует уточнения",
  },
  [UploadRowStatus.FAILED]: {
    className: "bg-danger/10 text-danger",
    label: "Ошибка",
  },
};

function StatusBadge({ row }: { row: UploadRow }) {
  const presentation = statusPresentation[row.status];

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${presentation.className}`}
      >
        {row.status === UploadRowStatus.READY ? (
          <span className="bg-success text-success-foreground grid size-4 place-items-center rounded-full">
            <UploadIcon className="size-2.5" name="check" />
          </span>
        ) : row.status === UploadRowStatus.NEEDS_REVIEW ? (
          <span className="bg-warning size-2 rounded-full" />
        ) : row.status === UploadRowStatus.FAILED ||
          row.status === UploadRowStatus.REJECTED ? (
          <span className="bg-danger size-2 rounded-full" />
        ) : null}
        {presentation.label}
      </span>
      {row.statusDetail ? (
        <span className="text-copy-muted max-w-56 truncate text-xs">
          {row.statusDetail}
        </span>
      ) : null}
    </div>
  );
}

function StageCell({ row }: { row: UploadRow }) {
  return (
    <div className="flex items-center gap-1.5">
      <StageBadge stage={row.stage} />
      {row.stageMismatch && row.detectedStage && row.declaredStage ? (
        <Tooltip>
          <Button
            aria-label={`Расхождение стадии: заявлена ${stageLabels[row.declaredStage]}, распознана ${stageLabels[row.detectedStage]}`}
            className="text-warning size-7 min-w-7 rounded-lg"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <UploadIcon className="size-4" name="warning" />
          </Button>
          <Tooltip.Content>
            Заявлена {stageLabels[row.declaredStage]}, распознана{" "}
            {stageLabels[row.detectedStage]}
          </Tooltip.Content>
        </Tooltip>
      ) : null}
    </div>
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

interface RowActionsProps {
  onAcceptDetectedStage: (fileId: string, stage: DocumentStage) => void;
  onChangeDeclaredStage: (clientFileId: string, stage: DocumentStage) => void;
  onDownload: (row: UploadRow) => void;
  onRemovePending: (clientFileId: string) => void;
  onRetry: (row: UploadRow) => void;
  row: UploadRow;
}

function RowActions({
  onAcceptDetectedStage,
  onChangeDeclaredStage,
  onDownload,
  onRemovePending,
  onRetry,
  row,
}: RowActionsProps) {
  const isLocalPending =
    row.origin === UploadRowOrigin.LOCAL &&
    row.status !== UploadRowStatus.UPLOADING &&
    row.status !== UploadRowStatus.ACCEPTED;

  return (
    <Popover>
      <Button
        aria-label={`Действия с файлом ${row.name}`}
        className="size-8 min-w-8 rounded-lg"
        isIconOnly
        size="sm"
        variant="ghost"
      >
        <UploadIcon className="size-4" name="more" />
      </Button>
      <Popover.Content className="border-border bg-popover rounded-xl border p-1 shadow-xl">
        <Popover.Dialog className="min-w-56 p-0.5 outline-none">
          {isLocalPending ? (
            <>
              <p className="text-copy-muted px-2.5 pt-2 pb-1 text-xs font-medium">
                Заявленная стадия
              </p>
              <div className="flex gap-1 px-1.5 pb-1.5">
                {(
                  [
                    DocumentStage.PD,
                    DocumentStage.RD,
                    DocumentStage.ID,
                  ] as const
                ).map((stage) => (
                  <Button
                    className="min-w-12 rounded-lg"
                    key={stage}
                    onPress={() =>
                      row.clientFileId &&
                      onChangeDeclaredStage(row.clientFileId, stage)
                    }
                    size="sm"
                    variant={
                      row.declaredStage === stage ? "secondary" : "outline"
                    }
                  >
                    {stageLabels[stage]}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
          {row.fileId && !row.integrityError ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() => onDownload(row)}
              size="sm"
              variant="ghost"
            >
              <UploadIcon className="size-4" name="download" />
              Скачать оригинал
            </Button>
          ) : null}
          {row.existingFileId ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() => onDownload(row)}
              size="sm"
              variant="ghost"
            >
              <UploadIcon className="size-4" name="download" />
              Скачать сохранённый файл
            </Button>
          ) : null}
          {row.retryKind === UploadRetryKind.PARSING ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() => onRetry(row)}
              size="sm"
              variant="ghost"
            >
              <UploadIcon className="size-4" name="play" />
              Повторить обработку
            </Button>
          ) : null}
          {row.retryKind === UploadRetryKind.CLASSIFICATION ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() => onRetry(row)}
              size="sm"
              variant="ghost"
            >
              <UploadIcon className="size-4" name="play" />
              Повторить классификацию
            </Button>
          ) : null}
          {row.stageMismatch && row.detectedStage && row.fileId ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() =>
                onAcceptDetectedStage(row.fileId!, row.detectedStage!)
              }
              size="sm"
              variant="ghost"
            >
              <UploadIcon className="size-4" name="check" />
              Принять стадию «{stageLabels[row.detectedStage]}»
            </Button>
          ) : null}
          {isLocalPending ? (
            <Button
              className="w-full justify-start rounded-lg"
              onPress={() =>
                row.clientFileId && onRemovePending(row.clientFileId)
              }
              size="sm"
              variant="danger-soft"
            >
              <UploadIcon className="size-4" name="trash" />
              Удалить из списка
            </Button>
          ) : null}
          {!isLocalPending &&
          !row.fileId &&
          !row.retryKind &&
          !row.stageMismatch ? (
            <p className="text-copy-muted px-2.5 py-2 text-xs">
              Нет доступных действий
            </p>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

export function DocumentsTable({
  failedCount,
  filter,
  needsReviewCount,
  onAcceptDetectedStage,
  onChangeDeclaredStage,
  onDownload,
  onFilterChange,
  onQueryChange,
  onRemovePending,
  onRetry,
  onSelectedIdsChange,
  query,
  rows,
  selectedIds,
  stageCounts,
  totalFiles,
}: DocumentsTableProps) {
  const selectableIds = rows
    .filter((row) => row.origin === UploadRowOrigin.LOCAL)
    .map((row) => row.id);
  const selectedVisibleCount = selectableIds.filter((id) =>
    selectedIds.has(id),
  ).length;
  const isAllVisibleSelected =
    selectableIds.length > 0 && selectedVisibleCount === selectableIds.length;
  const isSelectionIndeterminate =
    selectedVisibleCount > 0 && !isAllVisibleSelected;

  const toggleAllVisible = (isSelected: boolean) => {
    const nextSelectedIds = new Set(selectedIds);
    selectableIds.forEach((id) => {
      if (isSelected) nextSelectedIds.add(id);
      else nextSelectedIds.delete(id);
    });
    onSelectedIdsChange(nextSelectedIds);
  };

  const toggleRow = (rowId: string, isSelected: boolean) => {
    const nextSelectedIds = new Set(selectedIds);
    if (isSelected) nextSelectedIds.add(rowId);
    else nextSelectedIds.delete(rowId);
    onSelectedIdsChange(nextSelectedIds);
  };

  const handleFilterChange = (keys: Set<Key>) => {
    const selectedFilter = keys.values().next().value;
    if (
      selectedFilter === UploadDocumentFilter.ALL ||
      selectedFilter === UploadDocumentFilter.NEEDS_REVIEW ||
      selectedFilter === UploadDocumentFilter.FAILED ||
      selectedFilter === DocumentStage.PD ||
      selectedFilter === DocumentStage.RD ||
      selectedFilter === DocumentStage.ID
    ) {
      onFilterChange(selectedFilter);
    }
  };

  const rowActions = (row: UploadRow) => (
    <RowActions
      onAcceptDetectedStage={onAcceptDetectedStage}
      onChangeDeclaredStage={onChangeDeclaredStage}
      onDownload={onDownload}
      onRemovePending={onRemovePending}
      onRetry={onRetry}
      row={row}
    />
  );

  const selectable = (row: UploadRow) => row.origin === UploadRowOrigin.LOCAL;

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
          {filterOptions(
            totalFiles,
            stageCounts,
            needsReviewCount,
            failedCount,
          ).map((option) => (
            <ToggleButton
              className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
              id={option.value}
              key={option.value}
              variant="ghost"
            >
              {option.label}
            </ToggleButton>
          ))}
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
                    ariaLabel="Выбрать все документы пакета"
                    isDisabled={selectableIds.length === 0}
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
                {rows.map((row) => (
                  <Table.Row
                    key={row.id}
                    className="has-[input:checked]:[&_td]:bg-accent/5 has-[input:checked]:[&_td]:text-accent"
                  >
                    <Table.Cell className="px-4">
                      <SelectionCheckbox
                        ariaLabel={`Выбрать ${row.name}`}
                        isDisabled={!selectable(row)}
                        isSelected={selectedIds.has(row.id)}
                        onChange={(isSelected) => toggleRow(row.id, isSelected)}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex min-w-0 items-center gap-3">
                        <UploadIcon name={row.extension} className="stroke-0" />
                        <span className="max-w-[280px] truncate text-sm font-medium">
                          {row.name}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <StageCell row={row} />
                    </Table.Cell>
                    <Table.Cell className="text-copy-muted text-sm">
                      —
                    </Table.Cell>
                    <Table.Cell className="text-copy-muted text-sm">
                      —
                    </Table.Cell>
                    <Table.Cell className="text-copy-muted text-sm">
                      —
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge row={row} />
                    </Table.Cell>
                    <Table.Cell>{rowActions(row)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <div className="divide-border border-border divide-y border-t min-[981px]:hidden">
        {rows.length === 0 ? (
          <p className="text-copy-muted px-5 py-12 text-center text-sm">
            Документы не найдены
          </p>
        ) : (
          rows.map((row) => (
            <article
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3"
              key={row.id}
            >
              <div className="flex flex-col items-center gap-2">
                <SelectionCheckbox
                  ariaLabel={`Выбрать ${row.name}`}
                  isDisabled={!selectable(row)}
                  isSelected={selectedIds.has(row.id)}
                  onChange={(isSelected) => toggleRow(row.id, isSelected)}
                />
                <UploadIcon name={row.extension} className="stroke-0" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StageCell row={row} />
                  <StatusBadge row={row} />
                </div>
              </div>
              {rowActions(row)}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
