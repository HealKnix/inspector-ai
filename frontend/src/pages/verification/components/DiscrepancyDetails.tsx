import {
  Button,
  Tabs,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
  useMediaQuery,
  type Key,
} from "@heroui/react";
import { useRef, useState } from "react";

import type { ApiFindingDetail } from "@/api/types/verification";
import { cn } from "@/lib/utils";
import {
  DECIDABLE_STATUSES,
  REJECTION_REASONS,
  labelForRejectionCode,
} from "@/pages/verification/lib/object-findings";
import {
  FindingStatus,
  type VerificationDocument,
  type VerificationFinding,
  type VerificationFindingDecision,
} from "@/pages/verification/types";

import { VerificationIcon } from "./VerificationIcon";
import { markerPresentation, statusLabels } from "./verification-presentation";

type DetailTab =
  "comparison" | "rationale" | "documents" | "evidence" | "history";
/** Действия инспектора — целевые статусы; CANDIDATE = вернуть в работу. */
type ReviewAction =
  | typeof FindingStatus.CONFIRMED_VIOLATION
  | typeof FindingStatus.NEGATIVE_VERIFIED
  | typeof FindingStatus.CLARIFICATION_REQUIRED
  | typeof FindingStatus.CANDIDATE;

interface ReviewDraft {
  action: ReviewAction;
  comment: string;
  error: string | null;
  findingId: string;
  reason: string;
}

const baseDetailTabs: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: "comparison", label: "Сравнение" },
  { id: "rationale", label: "Обоснование" },
  { id: "documents", label: "Связанные документы" },
];

const apiDetailTabs: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: "evidence", label: "Доказательства" },
  { id: "history", label: "История решений" },
];

const rejectionReasons = REJECTION_REASONS.map((reason) => reason.label);

const decisionActionLabels: Record<string, string> = {
  confirm: "Подтверждено нарушение",
  reject: "Отклонено инспектором",
  clarify: "Запрошено уточнение",
  reopen: "Возвращено в работу",
};

const actionLabels: Record<ReviewAction, string> = {
  [FindingStatus.CONFIRMED_VIOLATION]: "Подтвердить нарушение",
  [FindingStatus.NEGATIVE_VERIFIED]: "Отклонить",
  [FindingStatus.CLARIFICATION_REQUIRED]: "Требует уточнения",
  [FindingStatus.CANDIDATE]: "Вернуть в работу",
};

/** Действия, доступные для текущего статуса находки (таблица переходов API). */
function availableActions(status: FindingStatus): ReviewAction[] {
  if (status === FindingStatus.CANDIDATE) {
    return [
      FindingStatus.CONFIRMED_VIOLATION,
      FindingStatus.NEGATIVE_VERIFIED,
      FindingStatus.CLARIFICATION_REQUIRED,
    ];
  }
  if (DECIDABLE_STATUSES.includes(status)) {
    return [FindingStatus.CANDIDATE];
  }
  return [];
}

interface DiscrepancyDetailsProps {
  actualDocument?: VerificationDocument;
  currentIndex: number;
  /** Карточка API-находки с членами группы и историей решений. */
  detail?: ApiFindingDetail;
  expectedDocument?: VerificationDocument;
  /** Имя файла по file_id для списка доказательств. */
  fileNames?: ReadonlyMap<string, string>;
  finding: VerificationFinding;
  onDecision: (decision: VerificationFindingDecision) => void | Promise<void>;
  onLocate?: (fileId: string, page: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  decisionPending?: boolean;
  /** Финализированный протокол или недоступный процесс — скрыть кнопки. */
  decisionsDisabled?: boolean;
  totalCount: number;
}

function EvidenceValue({
  label,
  value,
  location,
}: {
  label: string;
  value: string;
  location: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-copy-muted text-xs">{label}</p>
      <p className="text-danger mt-1 text-base font-semibold break-words">
        {value}
      </p>
      <p className="text-copy-muted mt-1 text-xs break-words">{location}</p>
    </div>
  );
}

function DocumentEvidence({
  document,
  evidence,
  label,
}: {
  document?: VerificationDocument;
  evidence: VerificationFinding["expectedEvidence"];
  label: string;
}) {
  const metaRows: ReadonlyArray<[string, string | undefined]> = [
    ["Стадия", document?.stage],
    ["Шифр", document?.cipher],
    ["Редакция", document?.revision],
    ["Изменение", document?.changeReference],
    ["Статус", document?.approvalStatus],
    [
      "Источник",
      evidence.page > 0
        ? `${evidence.location}, стр. ${evidence.page}`
        : evidence.location,
    ],
  ];

  return (
    <article className="border-border min-w-0 border-l pl-4 first:border-l-0 first:pl-0">
      <p className="text-copy-muted text-xs font-medium">{label}</p>
      <h4 className="mt-1 text-sm font-semibold break-words">
        {document?.title ?? "Документ не привязан"}
      </h4>
      <dl className="text-copy-muted mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        {metaRows
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([name, value]) => (
            <div className="contents" key={name}>
              <dt>{name}</dt>
              <dd className="text-foreground break-words">{value}</dd>
            </div>
          ))}
      </dl>
      {evidence.excerpt ? (
        <blockquote className="bg-surface-high text-foreground mt-3 rounded-xl px-3 py-2 text-xs leading-5">
          {evidence.excerpt}
        </blockquote>
      ) : null}
    </article>
  );
}

export function DiscrepancyDetails({
  actualDocument,
  currentIndex,
  detail,
  expectedDocument,
  fileNames,
  finding,
  onDecision,
  onLocate,
  onNext,
  onPrevious,
  decisionPending = false,
  decisionsDisabled = false,
  totalCount,
}: DiscrepancyDetailsProps) {
  const [tabState, setTabState] = useState<{
    findingId: string;
    tab: DetailTab;
  }>({ findingId: finding.id, tab: "comparison" });
  const isMobile = useMediaQuery("(max-width: 760px)");
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const clarifyButtonRef = useRef<HTMLButtonElement>(null);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const activeTab =
    tabState.findingId === finding.id ? tabState.tab : "comparison";
  const currentDraft =
    reviewDraft?.findingId === finding.id ? reviewDraft : null;
  const marker = markerPresentation[finding.uiMarker];
  const actions = decisionsDisabled
    ? []
    : availableActions(finding.findingStatus);
  const detailTabs = detail
    ? [...baseDetailTabs, ...apiDetailTabs]
    : baseDetailTabs;

  const startReview = (action: ReviewAction) => {
    setReviewDraft({
      action,
      comment: finding.reviewComment ?? "",
      error: null,
      findingId: finding.id,
      reason:
        action === FindingStatus.NEGATIVE_VERIFIED
          ? (finding.decisionReason ?? "")
          : "",
    });
  };

  const focusActionButton = (action: ReviewAction) => {
    const preferred =
      action === FindingStatus.CONFIRMED_VIOLATION
        ? confirmButtonRef
        : action === FindingStatus.NEGATIVE_VERIFIED
          ? rejectButtonRef
          : action === FindingStatus.CLARIFICATION_REQUIRED
            ? clarifyButtonRef
            : reopenButtonRef;

    // После решения кнопка исходного действия может исчезнуть (смена статуса) —
    // тогда фокус уходит на первое оставшееся доступное действие.
    queueMicrotask(() => {
      if (preferred.current?.isConnected) {
        preferred.current.focus();
        return;
      }
      for (const ref of [
        confirmButtonRef,
        rejectButtonRef,
        clarifyButtonRef,
        reopenButtonRef,
      ]) {
        if (ref.current?.isConnected) {
          ref.current.focus();
          return;
        }
      }
    });
  };

  const closeReview = () => {
    if (!currentDraft) return;

    const { action } = currentDraft;
    setReviewDraft(null);
    focusActionButton(action);
  };

  const failDraft = (message: string) => {
    setReviewDraft((draft) =>
      draft?.findingId === finding.id ? { ...draft, error: message } : draft,
    );
  };

  const submitReview = async () => {
    if (!currentDraft || decisionPending) return;

    const comment = currentDraft.comment.trim();
    const reason = currentDraft.reason.trim();

    if (
      (currentDraft.action === FindingStatus.NEGATIVE_VERIFIED ||
        currentDraft.action === FindingStatus.CLARIFICATION_REQUIRED) &&
      !comment
    ) {
      failDraft("Для решения нужен комментарий.");
      return;
    }
    if (currentDraft.action === FindingStatus.NEGATIVE_VERIFIED && !reason) {
      failDraft("Для отклонения необходимо указать причину.");
      return;
    }

    try {
      if (currentDraft.action === FindingStatus.NEGATIVE_VERIFIED) {
        await onDecision({
          findingStatus: FindingStatus.NEGATIVE_VERIFIED,
          reason,
          comment,
        });
      } else {
        await onDecision({
          findingStatus: currentDraft.action,
          comment,
        });
      }
      closeReview();
    } catch (caughtError) {
      failDraft(
        caughtError instanceof Error
          ? caughtError.message
          : "Не удалось применить решение.",
      );
    }
  };

  const handleReasonChange = (keys: Set<Key>) => {
    const value = keys.values().next().value;
    if (typeof value !== "string") return;

    setReviewDraft((draft) =>
      draft?.findingId === finding.id ? { ...draft, reason: value } : draft,
    );
  };

  const handleTabChange = (key: Key) => {
    if (detailTabs.some((tab) => tab.id === key)) {
      setTabState({ findingId: finding.id, tab: key as DetailTab });
    }
  };

  return (
    <section
      aria-labelledby="selected-finding-title"
      className="border-border bg-card grid min-w-0 grid-cols-[56px_minmax(0,1fr)] overflow-hidden rounded-[20px] border shadow-sm"
    >
      <div className="border-border bg-surface-low flex min-h-72 flex-col items-center justify-between border-r px-2 py-3">
        <Button
          aria-label="Предыдущее расхождение"
          className="size-10 min-w-10 rounded-xl"
          isDisabled={totalCount < 2}
          isIconOnly
          onPress={onPrevious}
          variant="outline"
        >
          <VerificationIcon className="size-4" name="chevron-up" />
        </Button>
        <span className="text-copy-muted text-center text-xs font-medium">
          {currentIndex + 1}
          <span className="my-1 block">/</span>
          {totalCount}
        </span>
        <Button
          aria-label="Следующее расхождение"
          className="size-10 min-w-10 rounded-xl"
          isDisabled={totalCount < 2}
          isIconOnly
          onPress={onNext}
          variant="outline"
        >
          <VerificationIcon className="size-4" name="chevron-down" />
        </Button>
      </div>

      <div className="min-w-0 p-4 sm:p-5">
        <div className="flex flex-col gap-4 min-[1080px]:flex-row min-[1080px]:items-start min-[1080px]:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-bold",
                  marker.dotClassName,
                )}
              >
                {finding.uiMarker === "formality" ? "i" : "!"}
              </span>
              <h2
                className="text-lg leading-6 font-semibold"
                id="selected-finding-title"
              >
                {finding.title}
              </h2>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  marker.badgeClassName,
                )}
              >
                {marker.label}
              </span>
              <span className="bg-surface-high text-foreground rounded-full px-2.5 py-1 text-xs">
                {statusLabels[finding.findingStatus]}
              </span>
            </div>
            <p className="text-copy-muted mt-2 max-w-3xl text-sm leading-5">
              {finding.description}
            </p>
          </div>

          {actions.length > 0 ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {actions.includes(FindingStatus.CONFIRMED_VIOLATION) ? (
                <Button
                  className="rounded-xl"
                  onPress={() => startReview(FindingStatus.CONFIRMED_VIOLATION)}
                  ref={confirmButtonRef}
                  size="sm"
                >
                  Подтвердить нарушение
                </Button>
              ) : null}
              {actions.includes(FindingStatus.NEGATIVE_VERIFIED) ? (
                <Button
                  className="rounded-xl"
                  onPress={() => startReview(FindingStatus.NEGATIVE_VERIFIED)}
                  ref={rejectButtonRef}
                  size="sm"
                  variant="outline"
                >
                  Отклонить
                </Button>
              ) : null}
              {actions.includes(FindingStatus.CLARIFICATION_REQUIRED) ? (
                <Button
                  className="rounded-xl"
                  onPress={() =>
                    startReview(FindingStatus.CLARIFICATION_REQUIRED)
                  }
                  ref={clarifyButtonRef}
                  size="sm"
                  variant="outline"
                >
                  Требует уточнения
                </Button>
              ) : null}
              {actions.includes(FindingStatus.CANDIDATE) ? (
                <Button
                  className="rounded-xl"
                  onPress={() => startReview(FindingStatus.CANDIDATE)}
                  ref={reopenButtonRef}
                  size="sm"
                  variant="outline"
                >
                  Вернуть в работу
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {currentDraft ? (
          <div className="border-border bg-surface-low mt-4 rounded-[16px] border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {actionLabels[currentDraft.action]}
                </h3>
                {finding.isSynthetic ? (
                  <p className="text-copy-muted mt-1 text-xs">
                    Это действие изменит только локальные синтетические данные.
                  </p>
                ) : null}
              </div>
              <Button
                aria-label="Закрыть форму решения"
                className="size-8 min-w-8 rounded-lg"
                isIconOnly
                onPress={closeReview}
                size="sm"
                variant="ghost"
              >
                <VerificationIcon className="size-4" name="close" />
              </Button>
            </div>

            {currentDraft.action === FindingStatus.NEGATIVE_VERIFIED ? (
              <div className="mt-4">
                <p className="text-copy-muted mb-2 text-xs font-medium">
                  Причина отклонения
                </p>
                <ToggleButtonGroup
                  aria-label="Причина отклонения"
                  className="flex flex-wrap gap-1.5"
                  isDetached
                  onSelectionChange={handleReasonChange}
                  selectedKeys={
                    currentDraft.reason
                      ? new Set<Key>([currentDraft.reason])
                      : new Set<Key>()
                  }
                  selectionMode="single"
                  size="sm"
                >
                  {rejectionReasons.map((option) => (
                    <ToggleButton
                      className="border-border data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full border px-3"
                      id={option}
                      key={option}
                      variant="ghost"
                    >
                      {option}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
            ) : null}

            <label className="text-copy-muted mt-4 block text-xs font-medium">
              Комментарий инспектора
              <TextArea
                aria-label="Комментарий инспектора"
                className="mt-2 min-h-24 w-full"
                onChange={(event) => {
                  const nextComment = event.target.value;
                  setReviewDraft((draft) =>
                    draft?.findingId === finding.id
                      ? { ...draft, comment: nextComment }
                      : draft,
                  );
                }}
                placeholder="Укажите основание решения…"
                value={currentDraft.comment}
                variant="secondary"
              />
            </label>
            {currentDraft.error ? (
              <p className="text-danger mt-2 text-xs" role="alert">
                {currentDraft.error}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button onPress={closeReview} size="sm" variant="ghost">
                Отмена
              </Button>
              <Button
                isDisabled={decisionPending}
                onPress={() => {
                  void submitReview();
                }}
                size="sm"
              >
                {decisionPending
                  ? "Сохраняем…"
                  : finding.isSynthetic
                    ? "Сохранить демо-решение"
                    : "Сохранить решение"}
              </Button>
            </div>
          </div>
        ) : null}

        <Tabs
          align="start"
          className="mt-4"
          onSelectionChange={handleTabChange}
          selectedKey={activeTab}
          variant="secondary"
        >
          <Tabs.ListContainer className="border-border border-b">
            <Tabs.List
              key={String(isMobile)}
              aria-label="Детали расхождения"
              className="gap-1"
            >
              {detailTabs.map((tab) => (
                <Tabs.Tab
                  className="text-foreground data-[selected=true]:text-accent after:bg-accent text-nowrap"
                  id={tab.id}
                  key={tab.id}
                >
                  {tab.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel className="pt-4" id="comparison">
            <div className="grid gap-4 min-[880px]:grid-cols-2 min-[1320px]:grid-cols-[1.2fr_1fr_1fr]">
              <div className="bg-surface-low grid min-w-0 grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-3 rounded-[16px] p-4">
                <EvidenceValue
                  label="Ожидаемое значение"
                  location={finding.expectedEvidence.location}
                  value={finding.expectedEvidence.value}
                />
                <VerificationIcon
                  className="text-accent size-5"
                  name="arrow-right"
                />
                <EvidenceValue
                  label="Фактическое значение"
                  location={finding.actualEvidence.location}
                  value={finding.actualEvidence.value}
                />
              </div>
              {finding.consequences?.length ? (
                <div className="bg-surface-high min-w-0 rounded-[16px] p-4">
                  <h3 className="text-sm font-semibold">Последствия</h3>
                  <ul className="text-copy-muted mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                    {finding.consequences.map((consequence) => (
                      <li key={consequence}>{consequence}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {finding.recommendation ? (
                <div className="bg-surface-high min-w-0 rounded-[16px] p-4 min-[880px]:col-span-2 min-[1320px]:col-span-1">
                  <h3 className="text-sm font-semibold">Рекомендации</h3>
                  <p className="text-copy-muted mt-2 text-xs leading-5">
                    {finding.recommendation}
                  </p>
                </div>
              ) : null}
            </div>
          </Tabs.Panel>

          <Tabs.Panel className="pt-4" id="rationale">
            <div className="grid gap-4 min-[900px]:grid-cols-2">
              <div className="bg-surface-low rounded-[16px] p-4">
                <h3 className="text-sm font-semibold">
                  Почему создан кандидат
                </h3>
                <p className="text-copy-muted mt-2 text-sm leading-6">
                  {finding.description}
                </p>
                <p className="text-copy-muted mt-3 text-xs leading-5">
                  Цветовой маркер служит только для навигации в интерфейсе и не
                  заменяет статус находки или решение инспектора.
                </p>
              </div>
              <div className="bg-surface-high rounded-[16px] p-4">
                <h3 className="text-sm font-semibold">Текущее решение</h3>
                <p className="text-copy-muted mt-2 text-sm">
                  {statusLabels[finding.findingStatus]}
                </p>
                {finding.decisionReason ? (
                  <p className="text-copy-muted mt-3 text-xs leading-5">
                    Причина: {finding.decisionReason}
                  </p>
                ) : null}
                {finding.reviewComment ? (
                  <p className="text-copy-muted mt-2 text-xs leading-5">
                    Комментарий: {finding.reviewComment}
                  </p>
                ) : null}
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel className="pt-4" id="documents">
            <div className="grid gap-4 min-[880px]:grid-cols-2">
              <DocumentEvidence
                document={expectedDocument}
                evidence={finding.expectedEvidence}
                label="Источник ожидаемого значения"
              />
              <DocumentEvidence
                document={actualDocument}
                evidence={finding.actualEvidence}
                label="Источник фактического значения"
              />
            </div>
          </Tabs.Panel>

          {detail ? (
            <Tabs.Panel className="pt-4" id="evidence">
              <ul className="grid gap-3">
                {detail.members.map((member) => (
                  <li
                    className="bg-surface-low rounded-[16px] p-4"
                    key={member.extraction_id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {member.role === "expected"
                          ? "Ожидаемая стадия"
                          : member.role === "actual"
                            ? "Проверяемая стадия"
                            : "Стадия не определена"}
                        {member.stage ? ` · ${member.stage}` : ""}
                      </p>
                      <span className="text-foreground text-sm font-semibold">
                        {member.value_raw ??
                          member.value?.toString() ??
                          "Значение не извлечено"}
                        {member.unit ? ` ${member.unit}` : ""}
                      </span>
                    </div>
                    <p className="text-copy-muted mt-1 text-xs break-all">
                      {fileNames?.get(member.file_id) ?? member.file_id}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {member.evidence.map((fragment, index) => (
                        <li
                          className="bg-surface-high rounded-xl px-3 py-2 text-xs leading-5"
                          key={`${fragment.blockId ?? fragment.pageNumber}:${index}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-copy-muted shrink-0">
                              стр. {fragment.pageNumber}
                              {fragment.blockId ? ` · ${fragment.blockId}` : ""}
                            </span>
                            {onLocate ? (
                              <Button
                                className="shrink-0 rounded-lg"
                                onPress={() =>
                                  onLocate(fragment.fileId, fragment.pageNumber)
                                }
                                size="sm"
                                variant="ghost"
                              >
                                Показать в документе
                              </Button>
                            ) : null}
                          </div>
                          <span className="text-foreground mt-1 block break-words">
                            {fragment.quote}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Tabs.Panel>
          ) : null}

          {detail ? (
            <Tabs.Panel className="pt-4" id="history">
              {detail.decisions.length === 0 ? (
                <p className="text-copy-muted text-sm">
                  Решений по находке ещё не принималось.
                </p>
              ) : (
                <ul className="space-y-3">
                  {detail.decisions.map((decision) => (
                    <li
                      className="bg-surface-low rounded-[16px] p-4"
                      key={decision.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {decisionActionLabels[decision.action]}
                        </p>
                        <span className="text-copy-muted text-xs">
                          {statusLabels[decision.from_status]} →{" "}
                          {statusLabels[decision.to_status]}
                        </span>
                      </div>
                      {decision.reason_code ? (
                        <p className="text-copy-muted mt-2 text-xs">
                          Причина:{" "}
                          {labelForRejectionCode(decision.reason_code) ??
                            decision.reason_code}
                        </p>
                      ) : null}
                      {decision.comment ? (
                        <p className="text-copy-muted mt-1 text-xs leading-5">
                          {decision.comment}
                        </p>
                      ) : null}
                      <p className="text-copy-muted mt-2 text-[11px]">
                        {new Date(decision.created_at).toLocaleString("ru-RU")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Tabs.Panel>
          ) : null}
        </Tabs>
      </div>
    </section>
  );
}
