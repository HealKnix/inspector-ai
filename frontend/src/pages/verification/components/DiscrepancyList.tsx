import {
  Button,
  ProgressBar,
  ScrollShadow,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";

import { Input } from "@/components/input/Input";
import { cn } from "@/lib/utils";
import {
  findingStatusGroupLabels,
  type FindingStatusGroup,
} from "@/pages/verification/lib/object-findings";
import {
  FindingStatus,
  VerificationFindingSort,
  VerificationUiMarker,
  type VerificationFinding,
  type VerificationSummary,
  type VerificationUiMarker as VerificationUiMarkerValue,
} from "@/pages/verification/types";

import { VerificationIcon } from "./VerificationIcon";
import {
  findingMarkerPresentation,
  markerPresentation,
  statusLabels,
} from "./verification-presentation";

const priorityLabels: Record<VerificationFinding["reviewPriority"], string> = {
  HIGH: "Высокий приоритет",
  MEDIUM: "Средний приоритет",
  LOW: "Низкий приоритет",
};

const sortOrder = [
  VerificationFindingSort.PRIORITY,
  VerificationFindingSort.ORDINAL,
  VerificationFindingSort.TITLE,
] as const;

const sortLabels: Record<(typeof sortOrder)[number], string> = {
  [VerificationFindingSort.PRIORITY]: "Сначала важные",
  [VerificationFindingSort.ORDINAL]: "По порядку",
  [VerificationFindingSort.TITLE]: "По названию",
};

interface DiscrepancyListProps {
  findings: readonly VerificationFinding[];
  markerFilter: VerificationUiMarkerValue | "all";
  onMarkerFilterChange: (value: VerificationUiMarkerValue | "all") => void;
  onQueryChange: (value: string) => void;
  onSelect: (findingId: string) => void;
  onSortChange: (value: VerificationFindingSort) => void;
  query: string;
  selectedId: string;
  sortBy: VerificationFindingSort;
  summary: VerificationSummary;
  parameterCount?: number;
  /** Режим реальных данных: фильтр по группам статусов вместо маркеров. */
  statusFilter?: FindingStatusGroup | "all";
  statusGroupCounts?: Record<FindingStatusGroup | "all", number>;
  onStatusFilterChange?: (value: FindingStatusGroup | "all") => void;
}

export function DiscrepancyList({
  findings,
  markerFilter,
  onMarkerFilterChange,
  onQueryChange,
  onSelect,
  onSortChange,
  query,
  selectedId,
  sortBy,
  summary,
  parameterCount,
  statusFilter,
  statusGroupCounts,
  onStatusFilterChange,
}: DiscrepancyListProps) {
  const statusFilterMode = statusFilter !== undefined && onStatusFilterChange;

  const handleMarkerChange = (keys: Set<Key>) => {
    const value = keys.values().next().value;

    if (
      value === "all" ||
      value === VerificationUiMarker.IMPACT ||
      value === VerificationUiMarker.ATTENTION ||
      value === VerificationUiMarker.FORMALITY
    ) {
      onMarkerFilterChange(value);
    }
  };

  const handleStatusChange = (keys: Set<Key>) => {
    const value = keys.values().next().value;

    if (typeof value === "string") {
      onStatusFilterChange?.(value as FindingStatusGroup | "all");
    }
  };

  const cycleSort = () => {
    const currentIndex = sortOrder.indexOf(
      sortBy as (typeof sortOrder)[number],
    );
    const nextIndex = (currentIndex + 1) % sortOrder.length;
    onSortChange(sortOrder[nextIndex] ?? VerificationFindingSort.PRIORITY);
  };

  return (
    <section className="border-border bg-card flex h-[680px] min-w-0 flex-col overflow-hidden rounded-[20px] border shadow-sm">
      <div className="border-border border-b px-4 pt-4 pb-3 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {statusFilterMode ? "Находки для проверки" : "Список расхождений"}
            </h2>
            <p className="text-copy-muted mt-1 text-xs">
              {statusFilterMode
                ? "Проверьте найденные сведения и примите решение"
                : "Кандидаты требуют решения инспектора"}
            </p>
          </div>
          <div className="w-36 shrink-0">
            {statusFilterMode ? (
              <p className="text-copy-muted text-right text-xs">
                Параметров:{" "}
                <strong className="text-foreground">
                  {parameterCount ?? "—"}
                </strong>
                <br />
                Находок:{" "}
                <strong className="text-foreground">
                  {summary.totalCount}
                </strong>
              </p>
            ) : (
              <>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className="text-copy-muted">Обработано</span>
                  <span className="font-semibold">
                    {summary.processedCount} из {summary.totalCount}
                  </span>
                </div>
                <ProgressBar
                  aria-label={`Обработано ${summary.processedCount} из ${summary.totalCount} расхождений`}
                  maxValue={summary.totalCount}
                  value={summary.processedCount}
                >
                  <ProgressBar.Track className="h-1.5">
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              </>
            )}
          </div>
        </div>

        <Input
          aria-label="Поиск в списке расхождений"
          className="mt-4"
          clearButtonLabel="Очистить поиск расхождений"
          onChange={onQueryChange}
          placeholder="Поиск по расхождениям…"
          type="search"
          value={query}
        />

        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          {statusFilterMode ? (
            <ToggleButtonGroup
              aria-label="Фильтр находок по статусу"
              className="w-max gap-1"
              disallowEmptySelection
              isDetached
              onSelectionChange={handleStatusChange}
              selectedKeys={new Set<Key>([statusFilter])}
              selectionMode="single"
              size="sm"
            >
              {(
                Object.keys(findingStatusGroupLabels) as Array<
                  FindingStatusGroup | "all"
                >
              )
                .filter(
                  (group) =>
                    group === "all" || (statusGroupCounts?.[group] ?? 0) > 0,
                )
                .map((group) => (
                  <ToggleButton
                    className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
                    id={group}
                    key={group}
                    variant="ghost"
                  >
                    {findingStatusGroupLabels[group]}{" "}
                    {statusGroupCounts?.[group] ?? ""}
                  </ToggleButton>
                ))}
            </ToggleButtonGroup>
          ) : (
            <ToggleButtonGroup
              aria-label="Фильтр расхождений"
              className="w-max gap-1"
              disallowEmptySelection
              isDetached
              onSelectionChange={handleMarkerChange}
              selectedKeys={new Set<Key>([markerFilter])}
              selectionMode="single"
              size="sm"
            >
              <ToggleButton
                className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
                id="all"
                variant="ghost"
              >
                Все {summary.totalCount}
              </ToggleButton>
              {(
                Object.values(
                  VerificationUiMarker,
                ) as VerificationUiMarkerValue[]
              ).map((marker) => (
                <ToggleButton
                  className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
                  id={marker}
                  key={marker}
                  variant="ghost"
                >
                  {markerPresentation[marker].label}{" "}
                  {summary.markerCounts[marker]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          <Button
            className="ml-auto shrink-0 rounded-full"
            onPress={cycleSort}
            size="sm"
            variant="outline"
          >
            <VerificationIcon className="size-4" name="sort" />
            {sortLabels[sortBy as (typeof sortOrder)[number]] ?? "Сортировка"}
          </Button>
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1 p-3" hideScrollBar>
        {findings.length === 0 ? (
          <div className="text-copy-muted grid min-h-64 place-items-center px-6 text-center text-sm">
            {statusFilterMode && summary.totalCount === 0 ? (
              <div>
                <p>Находок для проверки пока нет.</p>
                <p className="mt-2">
                  Это не означает, что все параметры проверены.
                </p>
              </div>
            ) : (
              "Расхождения по выбранным условиям не найдены."
            )}
          </div>
        ) : (
          <div className="space-y-2.5" role="list">
            {findings.map((finding) => {
              const marker = findingMarkerPresentation(finding);
              const isSelected = finding.id === selectedId;

              return (
                <div key={finding.id} role="listitem">
                  <Button
                    aria-label={`Открыть расхождение ${finding.ordinal}: ${finding.title}`}
                    aria-pressed={isSelected}
                    className={cn(
                      "border-border bg-surface hover:bg-surface-high h-auto min-h-32 w-full items-start justify-start rounded-[16px] border px-4 py-3.5 text-left whitespace-normal shadow-none",
                      isSelected &&
                        "border-accent bg-accent/5 ring-accent/15 ring-2",
                    )}
                    onPress={() => onSelect(finding.id)}
                    variant="ghost"
                  >
                    <span className="flex w-full min-w-0 items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                          marker.dotClassName,
                        )}
                      >
                        {(!finding.isSynthetic &&
                          finding.findingStatus !==
                            FindingStatus.CONFIRMED_VIOLATION) ||
                        finding.uiMarker === VerificationUiMarker.FORMALITY
                          ? "i"
                          : "!"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-sm leading-5 font-semibold">
                            {finding.title}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                              marker.badgeClassName,
                            )}
                          >
                            {marker.label}
                          </span>
                        </span>
                        {finding.contextLabel ? (
                          <span className="text-copy-muted mt-1 block text-xs">
                            {finding.contextLabel}
                          </span>
                        ) : null}
                        {finding.expectedEvidence.value === "—" &&
                        finding.actualEvidence.value === "—" &&
                        finding.sourcePreview ? (
                          <span className="text-copy-muted mt-2 line-clamp-3 block text-xs">
                            В документе: «{finding.sourcePreview}»
                          </span>
                        ) : (
                          <span className="text-copy-muted mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
                            <span className="truncate">
                              Ожидалось: {finding.expectedEvidence.value}
                            </span>
                            <span className="truncate">
                              Найдено: {finding.actualEvidence.value}
                            </span>
                          </span>
                        )}
                        <span className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-2 text-[11px]">
                          <span className="text-copy-muted">
                            № {finding.ordinal} ·{" "}
                            {priorityLabels[finding.reviewPriority]}
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              finding.findingStatus === FindingStatus.CANDIDATE
                                ? "text-copy-muted"
                                : "text-accent",
                            )}
                          >
                            {finding.statusLabel ??
                              statusLabels[finding.findingStatus]}
                          </span>
                        </span>
                      </span>
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </ScrollShadow>
    </section>
  );
}
