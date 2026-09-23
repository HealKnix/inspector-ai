import { Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/errors";
import { useObject } from "@/api/hooks/use-objects";
import { parsingErrorMessage, useParsingStatus } from "@/api/hooks/use-parsing";
import {
  useFinding,
  useFindings,
  useProtocol,
  useVerificationMutations,
  verificationErrorMessage,
} from "@/api/hooks/use-verification";
import type { ParsingFile } from "@/api/types/parsing";
import type { ApiFindingDetail } from "@/api/types/verification";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import {
  FindingStatusGroup,
  decisionActionFor,
  filterFindingsByGroup,
  findingStatusGroup,
  pickEvidencePair,
  rejectionCodeForLabel,
  toVerificationDocument,
  toVerificationFinding,
} from "@/pages/verification/lib/object-findings";
import {
  getVerificationSummary,
  searchVerificationFindings,
  sortVerificationFindings,
} from "@/pages/verification/lib/verification";
import {
  FindingStatus,
  VerificationFindingSort,
  type VerificationDocument,
  type VerificationFindingDecision,
  type VerificationUiMarker,
} from "@/pages/verification/types";
import routeNames from "@/routes/routeNames";

import { DiscrepancyDetails } from "./DiscrepancyDetails";
import { DiscrepancyList } from "./DiscrepancyList";
import { ParsedDocumentPane } from "./ParsedDocumentPane";

const parsingStatePresentation: Record<
  ParsingFile["state"],
  { label: string; className: string; dotClassName: string }
> = {
  queued: {
    label: "В очереди",
    className: "bg-default/60 text-foreground",
    dotClassName: "bg-copy-muted",
  },
  processing: {
    label: "Обрабатывается",
    className: "bg-warning/10 text-foreground",
    dotClassName: "bg-warning",
  },
  succeeded: {
    label: "Готово к просмотру",
    className: "bg-success/10 text-foreground",
    dotClassName: "bg-success",
  },
  failed: {
    label: "Ошибка обработки",
    className: "bg-danger/10 text-foreground",
    dotClassName: "bg-danger",
  },
};

function positivePage(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function LoadingState({ children }: { children: string }) {
  return (
    <div className="text-copy-muted grid min-h-72 place-items-center p-6 text-sm">
      <p role="status">{children}</p>
    </div>
  );
}

function QueryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto grid min-h-72 max-w-xl place-items-center p-6">
      <div
        className="border-border bg-card w-full space-y-4 rounded-[20px] border p-6"
        role="alert"
      >
        <p className="text-danger text-sm">{message}</p>
        <Button onPress={onRetry} variant="outline">
          Повторить
        </Button>
      </div>
    </div>
  );
}

function PackageDocumentsPanel({ files }: { files: readonly ParsingFile[] }) {
  const readyCount = files.filter(
    (file) => file.state === "succeeded" && file.artifact_id,
  ).length;

  return (
    <aside className="border-line bg-card flex h-[680px] min-w-0 flex-col overflow-hidden rounded-2xl border">
      <div className="border-line border-b p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Документы комплекта</h2>
          <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-xs font-semibold">
            {files.length}
          </span>
        </div>
        <p className="text-copy-muted mt-2 text-xs leading-5">
          К предпросмотру готовы {readyCount} из {files.length}. Состояния
          относятся к обработке файлов, а не к проверке метаданных.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-2">
          {files.map((file) => {
            const presentation = parsingStatePresentation[file.state];

            return (
              <li
                className="border-line bg-surface-low rounded-xl border p-3"
                key={`${file.file_id}:${file.run_id}`}
              >
                <p className="truncate text-sm font-medium">
                  {file.original_name}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${presentation.className}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${presentation.dotClassName}`}
                    />
                    {presentation.label}
                  </span>
                  <span className="text-copy-muted text-[11px] tabular-nums">
                    {file.pages_total === null
                      ? `${file.pages_completed} стр. обработано`
                      : `${file.pages_completed} / ${file.pages_total} стр.`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

export function ObjectVerificationWorkspace({
  objectId,
}: {
  objectId: string;
}) {
  const objectQuery = useObject(objectId);
  const object = objectQuery.isError ? undefined : objectQuery.data;
  const parsingQuery = useParsingStatus(objectId, Boolean(object));
  const parsing = parsingQuery.isError ? undefined : parsingQuery.data;
  const [searchParams, setSearchParams] = useSearchParams();
  const protocolQuery = useProtocol(objectId, Boolean(object));
  const protocol = protocolQuery.isError ? undefined : protocolQuery.data;
  const hasProtocol = Boolean(protocol?.protocol);
  const findingsQuery = useFindings(objectId, hasProtocol);
  const [statusFilter, setStatusFilter] = useState<
    FindingStatusGroup | "all" | undefined
  >(undefined);
  const [markerFilter] = useState<VerificationUiMarker | "all">("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<VerificationFindingSort>(
    VerificationFindingSort.PRIORITY,
  );
  const [actionError, setActionError] = useState("");
  const mutations = useVerificationMutations(objectId);

  const selectedFindingId = searchParams.get("finding") ?? "";
  const detailQuery = useFinding(
    objectId,
    selectedFindingId || null,
    hasProtocol,
  );
  const detail: ApiFindingDetail | undefined = detailQuery.data?.finding;

  const files = useMemo(() => parsing?.items ?? [], [parsing]);
  const fileNames = useMemo(
    () =>
      new Map<string, string>(
        files.map((file) => [file.file_id, file.original_name]),
      ),
    [files],
  );
  const fileStages = useMemo(() => {
    const stages = new Map<string, string>();
    for (const member of detail?.members ?? []) {
      if (member.stage) stages.set(member.file_id, member.stage);
    }
    return stages;
  }, [detail]);
  const documentsById = useMemo(
    () =>
      new Map<string, VerificationDocument>(
        files.map((file) => [
          file.file_id,
          toVerificationDocument(file, fileStages.get(file.file_id)),
        ]),
      ),
    [files, fileStages],
  );

  const findings = useMemo(() => {
    const items = findingsQuery.data?.items ?? [];
    return items.map((item, index) =>
      toVerificationFinding(
        item,
        index + 1,
        detail?.id === item.id ? detail : undefined,
      ),
    );
  }, [findingsQuery.data, detail]);

  const summary = useMemo(() => getVerificationSummary(findings), [findings]);
  const statusGroupCounts = useMemo(() => {
    const counts = { all: findings.length } as Record<
      FindingStatusGroup | "all",
      number
    >;
    for (const group of Object.values(FindingStatusGroup)) counts[group] = 0;
    for (const finding of findings)
      counts[findingStatusGroup(finding.findingStatus)] += 1;
    return counts;
  }, [findings]);
  const effectiveStatusFilter =
    statusFilter ??
    (statusGroupCounts[FindingStatusGroup.CANDIDATES] > 0
      ? FindingStatusGroup.CANDIDATES
      : "all");
  const visibleFindings = useMemo(
    () =>
      sortVerificationFindings(
        filterFindingsByGroup(
          searchVerificationFindings(findings, query, [
            ...documentsById.values(),
          ]),
          effectiveStatusFilter,
        ),
        sortBy,
      ),
    [findings, query, documentsById, effectiveStatusFilter, sortBy],
  );
  const selectedFinding =
    findings.find((finding) => finding.id === selectedFindingId) ??
    visibleFindings[0];

  // Автовыбор первой видимой находки: без `finding` в URL карточка
  // показывает visibleFindings[0], но деталь и история не подгружены.
  useEffect(() => {
    if (selectedFindingId || !selectedFinding) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("finding", selectedFinding.id);
        return next;
      },
      { replace: true },
    );
  }, [selectedFindingId, selectedFinding, setSearchParams]);

  const evidencePair = useMemo(
    () =>
      detail && selectedFinding && detail.id === selectedFinding.id
        ? pickEvidencePair(detail)
        : null,
    [detail, selectedFinding],
  );
  const leftMatchIds = useMemo(
    () =>
      new Set(
        (evidencePair?.expected?.member.evidence ?? [])
          .map((fragment) => fragment.blockId)
          .filter((id): id is string => Boolean(id)),
      ),
    [evidencePair],
  );
  const rightMatchIds = useMemo(
    () =>
      new Set(
        (evidencePair?.actual?.member.evidence ?? [])
          .map((fragment) => fragment.blockId)
          .filter((id): id is string => Boolean(id)),
      ),
    [evidencePair],
  );

  if (objectQuery.isPending) {
    return <LoadingState>Загружаем объект проверки…</LoadingState>;
  }

  if (objectQuery.error) {
    return (
      <QueryError
        message={objectQuery.error.message}
        onRetry={() => {
          void objectQuery.refetch();
        }}
      />
    );
  }

  if (!object) {
    return <LoadingState>Объект проверки недоступен.</LoadingState>;
  }

  if (parsingQuery.isPending) {
    return <LoadingState>Загружаем документы комплекта…</LoadingState>;
  }

  if (parsingQuery.error) {
    return (
      <QueryError
        message={parsingErrorMessage(parsingQuery.error)}
        onRetry={() => {
          void parsingQuery.refetch();
        }}
      />
    );
  }

  const readyFiles = files.filter(
    (file): file is ParsingFile & { artifact_id: string } =>
      file.state === "succeeded" && Boolean(file.artifact_id),
  );

  const updateSearchParam = (name: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(name, value);
        return next;
      },
      { replace: true },
    );
  };

  const setPane = (
    slot: "left" | "right",
    fileId: string | undefined,
    page?: number,
  ) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (fileId) next.set(`${slot}File`, fileId);
        if (page && page > 0) next.set(`${slot}Page`, String(page));
        else next.delete(`${slot}Page`);
        return next;
      },
      { replace: true },
    );
  };

  const selectFinding = (findingId: string) => {
    const finding = findings.find((candidate) => candidate.id === findingId);
    if (!finding) return;

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("finding", finding.id);
        if (finding.expectedEvidence.documentId)
          next.set("leftFile", finding.expectedEvidence.documentId);
        if (finding.actualEvidence.documentId)
          next.set("rightFile", finding.actualEvidence.documentId);
        if (finding.expectedEvidence.page > 0)
          next.set("leftPage", String(finding.expectedEvidence.page));
        else next.delete("leftPage");
        if (finding.actualEvidence.page > 0)
          next.set("rightPage", String(finding.actualEvidence.page));
        else next.delete("rightPage");
        return next;
      },
      { replace: true },
    );
    setActionError("");
  };

  const locateEvidence = (fileId: string, page: number) => {
    const currentLeft = searchParams.get("leftFile");
    if (currentLeft === fileId) {
      setPane("left", fileId, page);
    } else {
      setPane("right", fileId, page);
    }
  };

  const applyDecision = async (decision: VerificationFindingDecision) => {
    if (!selectedFinding?.findingVersion) return;

    const reasonCode =
      decision.findingStatus === FindingStatus.NEGATIVE_VERIFIED
        ? rejectionCodeForLabel(decision.reason)
        : undefined;
    if (
      decision.findingStatus === FindingStatus.NEGATIVE_VERIFIED &&
      !reasonCode
    ) {
      throw new Error("Неизвестная причина отклонения.");
    }

    try {
      await mutations.decide.mutateAsync({
        findingId: selectedFinding.id,
        body: {
          request_id: crypto.randomUUID(),
          action: decisionActionFor(decision.findingStatus),
          finding_version: selectedFinding.findingVersion,
          reason_code: reasonCode ?? undefined,
          comment: decision.comment.trim() || undefined,
        },
      });
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 409) {
        void findingsQuery.refetch();
        void detailQuery.refetch();
      }
      throw caughtError;
    }
  };

  const runProtocolAction = async (
    action: () => Promise<unknown>,
    fallback: string,
  ) => {
    setActionError("");
    try {
      await action();
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : fallback,
      );
    }
  };

  const leftFile =
    readyFiles.find((file) => file.file_id === searchParams.get("leftFile")) ??
    readyFiles[0];
  const rightFile =
    readyFiles.find((file) => file.file_id === searchParams.get("rightFile")) ??
    readyFiles[1];

  const selectFile = (slot: "left" | "right", fileId: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(`${slot}File`, fileId);
        next.delete(`${slot}Page`);
        return next;
      },
      { replace: true },
    );
  };

  const processStatus = protocol?.process_status ?? "";
  const candidateCount = summary.statusCounts[FindingStatus.CANDIDATE];
  const protocolReadOnly =
    processStatus === "FINALIZED" || protocol?.protocol?.status === "finalized";
  // Решения принимаются только в READY/VERIFYING: в COMPLETED находки уже
  // решены, в FINALIZED протокол закрыт — форму скрываем, не дожидаясь 409.
  const decisionsLocked =
    hasProtocol && !["READY", "VERIFYING"].includes(processStatus);
  const canFinalize = hasProtocol && candidateCount === 0 && !protocolReadOnly;
  const expectedDocument = selectedFinding?.expectedEvidence.documentId
    ? documentsById.get(selectedFinding.expectedEvidence.documentId)
    : undefined;
  const actualDocument = selectedFinding?.actualEvidence.documentId
    ? documentsById.get(selectedFinding.actualEvidence.documentId)
    : undefined;

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.OBJECT_UPLOAD(objectId)}
        backLabel="Вернуться к объекту"
        breadcrumbs={["Проверки", object.name, "Метаданные и страницы"]}
        badge="Инспектор"
        notice={
          <>
            Показаны фактические страницы и находки текущей версии протокола
            объекта «{object.name}».
          </>
        }
        noticeLabel="ДАННЫЕ ОБЪЕКТА"
        title="Проверка комплекта документов"
        actions={
          hasProtocol || protocolQuery.isPending ? (
            <div className="flex flex-col gap-2 self-end sm:flex-row sm:items-center sm:justify-end">
              <p className="text-copy-muted text-xs leading-5 sm:mr-auto">
                {protocolReadOnly
                  ? `Протокол v${protocol?.protocol?.version} финализирован — решения заблокированы.`
                  : hasProtocol
                    ? `Протокол v${protocol?.protocol?.version} · ${processStatus || "—"} · кандидатов без решения: ${candidateCount}.`
                    : "Загружаем протокол…"}
              </p>
              {hasProtocol ? (
                <Button
                  className="rounded-xl"
                  isDisabled={!canFinalize || mutations.finalize.isPending}
                  onPress={() =>
                    void runProtocolAction(
                      () => mutations.finalize.mutateAsync(),
                      "Не удалось финализировать протокол.",
                    )
                  }
                >
                  Финализировать протокол
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2 self-end sm:flex-row sm:items-center sm:justify-end">
              <p className="text-copy-muted text-xs leading-5 sm:mr-auto">
                Протокол ещё не сформирован — решения по находкам станут
                доступны после генерации.
              </p>
              <Button
                className="rounded-xl"
                isDisabled={mutations.generate.isPending}
                onPress={() =>
                  void runProtocolAction(
                    () => mutations.generate.mutateAsync(),
                    "Не удалось сформировать протокол.",
                  )
                }
              >
                Сформировать протокол
              </Button>
            </div>
          )
        }
      />
      {actionError ? (
        <p className="text-danger mt-3 text-sm" role="alert">
          {actionError}
        </p>
      ) : null}

      {files.length === 0 ? (
        <section className="border-line bg-card text-copy-muted mt-5 grid min-h-72 place-items-center rounded-2xl border p-6 text-center text-sm">
          В объекте пока нет документов, зарегистрированных для обработки.
        </section>
      ) : readyFiles.length === 0 ? (
        <div className="mt-5 grid gap-4 min-[1100px]:grid-cols-12">
          <section className="border-line bg-card text-copy-muted grid min-h-72 place-items-center rounded-2xl border p-6 text-center text-sm min-[1100px]:col-span-8">
            Страницы появятся после успешного завершения обработки хотя бы
            одного документа.
          </section>
          <div className="min-[1100px]:col-span-4">
            <PackageDocumentsPanel files={files} />
          </div>
        </div>
      ) : (
        <div className="mt-5 grid items-stretch gap-4 min-[1440px]:grid-cols-12">
          <div
            className={`grid min-w-0 gap-4 min-[1440px]:col-span-8 ${rightFile ? "min-[840px]:grid-cols-2" : "grid-cols-1"}`}
          >
            {leftFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={leftFile}
                files={readyFiles}
                key={`left:${leftFile.file_id}:${leftFile.run_id}:${leftFile.artifact_id}`}
                label="Ожидаемое (ПД)"
                matchIds={leftMatchIds}
                objectId={objectId}
                onFileChange={(fileId) => selectFile("left", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("leftPage", String(page))
                }
                pageNumber={positivePage(searchParams.get("leftPage"))}
              />
            )}
            {rightFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={rightFile}
                files={readyFiles}
                key={`right:${rightFile.file_id}:${rightFile.run_id}:${rightFile.artifact_id}`}
                label="Фактическое (РД/ИД)"
                matchIds={rightMatchIds}
                objectId={objectId}
                onFileChange={(fileId) => selectFile("right", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("rightPage", String(page))
                }
                pageNumber={positivePage(searchParams.get("rightPage"))}
              />
            )}
          </div>
          <div className="min-w-0 min-[1440px]:col-span-4">
            {hasProtocol ? (
              <DiscrepancyList
                findings={visibleFindings}
                markerFilter={markerFilter}
                onMarkerFilterChange={() => undefined}
                onQueryChange={setQuery}
                onSelect={selectFinding}
                onSortChange={setSortBy}
                query={query}
                selectedId={selectedFinding?.id ?? ""}
                sortBy={sortBy}
                statusFilter={effectiveStatusFilter}
                statusGroupCounts={statusGroupCounts}
                onStatusFilterChange={setStatusFilter}
                summary={summary}
              />
            ) : (
              <PackageDocumentsPanel files={files} />
            )}
          </div>
        </div>
      )}

      {hasProtocol && findingsQuery.isPending ? (
        <p className="text-copy-muted mt-4 text-sm" role="status">
          Загружаем находки протокола…
        </p>
      ) : null}
      {hasProtocol && findingsQuery.error ? (
        <div className="mt-4" role="alert">
          <QueryError
            message={verificationErrorMessage(findingsQuery.error)}
            onRetry={() => {
              void findingsQuery.refetch();
            }}
          />
        </div>
      ) : null}

      {hasProtocol && selectedFinding ? (
        <div className="mt-4 pb-6">
          <DiscrepancyDetails
            actualDocument={actualDocument}
            currentIndex={Math.max(
              visibleFindings.findIndex(
                (finding) => finding.id === selectedFinding.id,
              ),
              0,
            )}
            detail={
              detail?.id === selectedFinding.id && !detailQuery.isPending
                ? detail
                : undefined
            }
            expectedDocument={expectedDocument}
            fileNames={fileNames}
            finding={selectedFinding}
            decisionPending={mutations.decide.isPending}
            decisionsDisabled={decisionsLocked}
            onDecision={applyDecision}
            onLocate={locateEvidence}
            onNext={() => {
              const index = visibleFindings.findIndex(
                (finding) => finding.id === selectedFinding.id,
              );
              const next = visibleFindings[index + 1] ?? visibleFindings[0];
              if (next) selectFinding(next.id);
            }}
            onPrevious={() => {
              const index = visibleFindings.findIndex(
                (finding) => finding.id === selectedFinding.id,
              );
              const previous =
                visibleFindings[index - 1] ??
                visibleFindings[visibleFindings.length - 1];
              if (previous) selectFinding(previous.id);
            }}
            totalCount={visibleFindings.length}
          />
        </div>
      ) : null}

      <section className="border-line bg-card mt-4 rounded-2xl border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="bg-warning/10 text-warning grid size-10 shrink-0 place-items-center rounded-xl">
            <UploadIcon className="size-5" name="info" />
          </span>
          <div>
            <h2 className="font-semibold">Проверка метаданных</h2>
            <p className="text-copy-muted mt-2 max-w-4xl text-sm leading-6">
              Шифр, редакция, утверждение и спорные поля документов пока не
              извлекаются конвейером — в карточках находок отображаются только
              фактические значения и локаторы доказательств.
            </p>
          </div>
        </div>
      </section>
    </ConstrainedLayout>
  );
}
