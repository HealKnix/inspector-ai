import { Button } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

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

import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { protocolIsCurrent } from "../lib/protocol-lifecycle";
import { isReviewFinding } from "../lib/review-findings";
import { DiscrepancyDetails } from "./DiscrepancyDetails";
import { DiscrepancyList } from "./DiscrepancyList";
import { ParsedDocumentPane } from "./ParsedDocumentPane";
import { ProtocolActions } from "./ProtocolActions";

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
  const selectedProtocolId = searchParams.get("protocolId") ?? undefined;
  const protocolQuery = useProtocol(
    objectId,
    Boolean(object),
    selectedProtocolId,
  );
  const protocol = protocolQuery.isError ? undefined : protocolQuery.data;
  const hasProtocol = Boolean(protocol?.protocol);
  const findingsQuery = useFindings(
    objectId,
    hasProtocol,
    protocol?.protocol?.id,
  );
  const findingsResponse =
    !findingsQuery.isError &&
    findingsQuery.data?.protocol_id === protocol?.protocol?.id
      ? findingsQuery.data
      : undefined;
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
  const reviewItems = useMemo(
    () => findingsResponse?.items.filter(isReviewFinding) ?? [],
    [findingsResponse],
  );
  const selectedIsExcluded = Boolean(
    selectedFindingId &&
    findingsResponse?.items.some((item) => item.id === selectedFindingId) &&
    !reviewItems.some((item) => item.id === selectedFindingId),
  );
  // Помечаем находку, для которой после загрузки detail нужно
  // автоматически открыть страницы доказательств в панелях.
  const pendingEvidenceNav = useRef<string | null>(null);
  const detailQuery = useFinding(
    objectId,
    selectedFindingId || null,
    hasProtocol &&
      Boolean(reviewItems.some((item) => item.id === selectedFindingId)),
  );
  const receivedDetail = detailQuery.isError
    ? undefined
    : detailQuery.data?.finding;
  const detail: ApiFindingDetail | undefined =
    reviewItems.some((item) => item.id === selectedFindingId) &&
    receivedDetail?.id === selectedFindingId &&
    receivedDetail.protocol_version === protocol?.protocol?.version &&
    (!protocol.protocol.run_id ||
      receivedDetail.run_id === protocol.protocol.run_id)
      ? receivedDetail
      : undefined;

  const frozenSources = hasProtocol;
  const browsingOriginals = Boolean(
    detail &&
    protocolIsCurrent(protocol) &&
    protocol?.protocol?.run_id === detail.run_id &&
    detail.run_id &&
    !detail.evidence_absent_reason &&
    !detail.members.some(
      (member) =>
        member.artifact_id ||
        member.evidence.some((fragment) => fragment.artifactId),
    ),
  );
  const files = useMemo<ParsingFile[]>(() => {
    if (protocolQuery.isPending || protocolQuery.isError) return [];
    if (!frozenSources) return parsing?.items ?? [];
    if (browsingOriginals)
      return (
        parsing?.items.filter((file) => file.run_id === detail?.run_id) ?? []
      );
    if (!detail?.run_id || detail.id !== selectedFindingId) return [];
    const byId = new Map<string, ParsingFile>();
    for (const member of detail.members) {
      const artifactId =
        member.artifact_id ??
        member.evidence.find((fragment) => fragment.artifactId)?.artifactId;
      if (!artifactId) continue;
      const current = parsing?.items.find(
        (file) => file.file_id === member.file_id,
      );
      byId.set(member.file_id, {
        file_id: member.file_id,
        process_id: current?.process_id ?? "",
        run_id: detail.run_id,
        artifact_id: artifactId,
        original_name:
          current?.original_name ?? `Источник ${member.file_id.slice(0, 8)}`,
        state: "succeeded",
        attempt: 0,
        pages_completed: 0,
        pages_total: null,
        quality: null,
        reasons: [],
        error_code: null,
        can_retry: false,
      });
    }
    return [...byId.values()];
  }, [
    parsing,
    frozenSources,
    browsingOriginals,
    detail,
    selectedFindingId,
    protocolQuery.isPending,
    protocolQuery.isError,
  ]);
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
    return reviewItems.map((item, index) =>
      toVerificationFinding(
        item,
        index + 1,
        detail?.id === item.id ? detail : undefined,
      ),
    );
  }, [reviewItems, detail]);

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
    statusFilter && statusGroupCounts[statusFilter] > 0 ? statusFilter : "all";
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
    selectedFindingId && !selectedIsExcluded
      ? findings.find((finding) => finding.id === selectedFindingId)
      : visibleFindings[0];

  // Автовыбор первой видимой находки: без `finding` в URL карточка
  // показывает visibleFindings[0], но деталь и история не подгружены.
  useEffect(() => {
    if (selectedFindingId && !selectedIsExcluded) return;
    if (!selectedFinding && !selectedIsExcluded) return;
    pendingEvidenceNav.current = selectedFinding?.id ?? null;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (selectedFinding) next.set("finding", selectedFinding.id);
        else next.delete("finding");
        if (selectedIsExcluded) {
          for (const key of ["leftFile", "leftPage", "rightFile", "rightPage"])
            next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [selectedFindingId, selectedFinding, selectedIsExcluded, setSearchParams]);

  const evidencePair = useMemo(
    () =>
      detail && selectedFinding && detail.id === selectedFinding.id
        ? pickEvidencePair(detail)
        : null,
    [detail, selectedFinding],
  );
  // После выбора находки и загрузки detail переводим обе панели на файл
  // и первую страницу доказательства — иначе подсветка остаётся на другой
  // странице и не видна. Срабатывает один раз на выбор, чтобы не перебивать
  // ручную навигацию пользователя по страницам.
  useEffect(() => {
    if (
      !evidencePair ||
      !selectedFinding ||
      pendingEvidenceNav.current !== selectedFinding.id
    )
      return;
    pendingEvidenceNav.current = null;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const expected = evidencePair.expected;
        const actual = evidencePair.actual;
        if (expected?.member.file_id)
          next.set("leftFile", expected.member.file_id);
        if (expected?.fragment?.pageNumber)
          next.set("leftPage", String(expected.fragment.pageNumber));
        if (actual?.member.file_id)
          next.set("rightFile", actual.member.file_id);
        if (actual?.fragment?.pageNumber)
          next.set("rightPage", String(actual.fragment.pageNumber));
        return next;
      },
      { replace: true },
    );
  }, [evidencePair, selectedFinding, setSearchParams]);

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

  if (parsingQuery.isPending && !hasProtocol) {
    return <LoadingState>Загружаем документы комплекта…</LoadingState>;
  }

  if (parsingQuery.error && !hasProtocol) {
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

    pendingEvidenceNav.current = finding.id;
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
    hasProtocol && !browsingOriginals && evidencePair && !evidencePair.expected
      ? undefined
      : (readyFiles.find(
          (file) => file.file_id === searchParams.get("leftFile"),
        ) ??
        readyFiles.find(
          (file) => file.file_id === evidencePair?.expected?.member.file_id,
        ) ??
        (evidencePair && !browsingOriginals ? undefined : readyFiles[0]));
  const rightFile =
    hasProtocol && !browsingOriginals && evidencePair && !evidencePair.actual
      ? undefined
      : (readyFiles.find(
          (file) =>
            file.file_id === searchParams.get("rightFile") &&
            (!browsingOriginals || file.file_id !== leftFile?.file_id),
        ) ??
        readyFiles.find(
          (file) => file.file_id === evidencePair?.actual?.member.file_id,
        ) ??
        (evidencePair && !browsingOriginals
          ? undefined
          : readyFiles.find((file) => file.file_id !== leftFile?.file_id)));
  const singleSource = hasProtocol && Boolean(leftFile) !== Boolean(rightFile);
  const registrySource =
    files.find((file) => file.process_id) ?? parsing?.items[0];
  const registryHref = routeNames.OBJECT_DOCUMENTS(
    objectId,
    registrySource
      ? {
          processId: registrySource.process_id,
          runId: protocol?.protocol?.run_id ?? registrySource.run_id,
          resolvedInputHash:
            protocol?.protocol?.resolved_input_hash ?? undefined,
        }
      : undefined,
  );
  const missingSourcePane = (
    <section
      aria-label="Источник сравнения не определён"
      className="border-line bg-card flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center sm:h-[680px]"
    >
      <h2 className="text-base font-semibold">
        Документ для сравнения не определён
      </h2>
      <p className="text-copy-muted max-w-xs text-sm">
        Уточните реквизиты и применимую редакцию в реестре документов.
      </p>
      <Link className="text-accent text-sm underline" to={registryHref}>
        Уточнить документы
      </Link>
    </section>
  );
  const panePage = (slot: "left" | "right", file: ParsingFile) => {
    const explicit = searchParams.get(`${slot}Page`);
    if (explicit) return positivePage(explicit);
    const evidence =
      slot === "left" ? evidencePair?.expected : evidencePair?.actual;
    return evidence?.member.file_id === file.file_id
      ? (evidence.fragment?.pageNumber ?? 1)
      : 1;
  };
  const paneLabel = (role: "expected" | "actual", file: ParsingFile) => {
    const stage = fileStages.get(file.file_id);
    const stageName =
      stage === "PD"
        ? "ПД"
        : stage === "RD"
          ? "РД"
          : stage === "ID"
            ? "ИД"
            : "";
    const name =
      browsingOriginals || !hasProtocol
        ? `Исходный документ ${role === "expected" ? "1" : "2"}`
        : role === "expected"
          ? "Эталонный документ"
          : "Проверяемый документ";
    return `${name}${stageName ? ` (${stageName})` : ""}`;
  };

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
  // Visibility does not relax the server's finalization policy.
  const candidateCount =
    findingsResponse?.items.filter(
      (finding) => finding.status === FindingStatus.CANDIDATE,
    ).length ?? 0;
  // Решения принимаются только в READY/VERIFYING: в COMPLETED находки уже
  // решены, в FINALIZED протокол закрыт — форму скрываем, не дожидаясь 409.
  const decisionsLocked =
    hasProtocol &&
    (!protocolIsCurrent(protocol) ||
      !["READY", "VERIFYING"].includes(processStatus));
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
        description={object.name}
        badge="Инспектор"
        title="Проверка комплекта документов"
        actions={
          <ProtocolActions
            response={protocol}
            loading={protocolQuery.isPending}
            candidateCount={candidateCount}
            findingCount={summary.totalCount}
            visibleCandidateCount={
              summary.statusCounts[FindingStatus.CANDIDATE]
            }
            findingsReady={Boolean(findingsResponse)}
            busy={mutations.generate.isPending || mutations.finalize.isPending}
            onGenerate={() =>
              runProtocolAction(async () => {
                const result = await mutations.generate.mutateAsync();
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete("protocolId");
                    next.delete("finding");
                    return next;
                  },
                  { replace: true },
                );
                return result;
              }, "Не удалось сформировать протокол.")
            }
            onFinalize={() =>
              runProtocolAction(
                () => mutations.finalize.mutateAsync(),
                "Не удалось финализировать протокол.",
              )
            }
          />
        }
      />
      {protocol && protocol.versions.length > 1 ? (
        <div className="mt-4 max-w-lg">
          <IdentificationSelect
            label="Версия протокола"
            value={selectedProtocolId ?? protocol.protocol?.id ?? ""}
            options={protocol.versions.map((version) => ({
              id: version.id,
              label: `Версия ${version.version} · ${version.status === "finalized" ? "финализирована" : version.is_current === false ? "историческая" : "сохранена"}`,
            }))}
            onChange={(value) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (value) next.set("protocolId", value);
                  else next.delete("protocolId");
                  next.delete("finding");
                  return next;
                },
                { replace: true },
              );
            }}
          />
        </div>
      ) : null}
      {actionError ? (
        <p className="text-danger mt-3 text-sm" role="alert">
          {actionError}
        </p>
      ) : null}
      {protocolQuery.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {verificationErrorMessage(protocolQuery.error)}
        </p>
      ) : null}

      {browsingOriginals || singleSource ? (
        <p
          className="border-border bg-card rounded-xl border p-4 text-sm"
          role="status"
        >
          Сравнение пока недоступно: не определена пара документов.
          {browsingOriginals ? " Можно просмотреть исходные документы." : ""}
        </p>
      ) : null}
      {
        <div className="mt-5 grid items-stretch gap-4 min-[1440px]:grid-cols-12">
          <div
            className={`grid min-w-0 gap-4 min-[1440px]:col-span-8 ${rightFile || singleSource ? "min-[840px]:grid-cols-2" : "grid-cols-1"}`}
          >
            {!leftFile && !rightFile ? (
              <section className="border-line bg-card text-copy-muted grid min-h-72 place-items-center rounded-2xl border p-6 text-center text-sm">
                {hasProtocol
                  ? findings.length
                    ? "Выберите находку, чтобы открыть документы."
                    : "Документы с находками появятся здесь."
                  : "Страницы появятся после успешного завершения обработки документов."}
              </section>
            ) : null}
            {singleSource && !leftFile ? missingSourcePane : null}
            {leftFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={leftFile}
                files={readyFiles}
                key={`left:${leftFile.file_id}:${leftFile.run_id}:${leftFile.artifact_id}`}
                label={paneLabel("expected", leftFile)}
                detail={browsingOriginals ? undefined : detail}
                objectId={objectId}
                onFileChange={(fileId) => selectFile("left", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("leftPage", String(page))
                }
                pageNumber={panePage("left", leftFile)}
              />
            )}
            {singleSource && !rightFile ? missingSourcePane : null}
            {rightFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={rightFile}
                files={readyFiles}
                key={`right:${rightFile.file_id}:${rightFile.run_id}:${rightFile.artifact_id}`}
                label={paneLabel("actual", rightFile)}
                detail={browsingOriginals ? undefined : detail}
                objectId={objectId}
                onFileChange={(fileId) => selectFile("right", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("rightPage", String(page))
                }
                pageNumber={panePage("right", rightFile)}
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
                parameterCount={
                  new Set(findings.map((finding) => finding.parameterCode)).size
                }
              />
            ) : (
              <PackageDocumentsPanel files={files} />
            )}
          </div>
        </div>
      }

      {hasProtocol &&
      selectedFindingId &&
      findingsResponse &&
      !selectedIsExcluded &&
      !selectedFinding ? (
        <p role="alert" className="text-danger mt-3">
          Эта находка не принадлежит выбранному протоколу. Выберите находку из
          списка.
        </p>
      ) : null}
      {detailQuery.isError ? (
        <p role="alert" className="text-danger mt-3">
          Не удалось получить зафиксированные доказательства.{" "}
          <Button onPress={() => void detailQuery.refetch()}>Повторить</Button>
        </p>
      ) : null}
      {receivedDetail && !detail && selectedFinding ? (
        <p role="alert" className="text-danger mt-3">
          Доказательства не соответствуют выбранной версии протокола.
        </p>
      ) : null}
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
          {detail?.evidence_absent_reason ? (
            <p role="status" className="text-warning mb-3 text-sm">
              Источники этой исторической находки не были зафиксированы. Текущие
              документы не подставляются вместо них.
            </p>
          ) : null}
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
            <h2 className="font-semibold">Реквизиты и применимые редакции</h2>
            <p className="text-copy-muted mt-2 max-w-4xl text-sm leading-6">
              Машинные кандидаты и подтверждённые уточнения доступны в реестре
              документов. Изменение реквизитов создаёт новый запуск;
              исторические доказательства сохраняются.
            </p>
            {parsing?.items[0] ? (
              <a
                className="text-accent mt-3 inline-block text-sm underline"
                href={routeNames.OBJECT_DOCUMENTS(objectId, {
                  processId: parsing.items[0].process_id,
                  runId: protocol?.protocol?.run_id ?? parsing.items[0].run_id,
                  resolvedInputHash:
                    protocol?.protocol?.resolved_input_hash ?? undefined,
                })}
              >
                Открыть документы и редакции
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </ConstrainedLayout>
  );
}
