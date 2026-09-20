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

import { cn } from "@/lib/utils";
import {
  FindingStatus,
  type VerificationDocument,
  type VerificationFinding,
  type VerificationFindingDecision,
} from "@/pages/verification/types";

import { VerificationIcon } from "./VerificationIcon";
import { markerPresentation, statusLabels } from "./verification-presentation";

type DetailTab = "comparison" | "rationale" | "documents";
type ReviewAction = Exclude<FindingStatus, typeof FindingStatus.CANDIDATE>;

interface ReviewDraft {
  action: ReviewAction;
  comment: string;
  error: string | null;
  findingId: string;
  reason: string;
}

const detailTabs: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: "comparison", label: "Сравнение" },
  { id: "rationale", label: "Обоснование" },
  { id: "documents", label: "Связанные документы" },
];

const rejectionReasons = [
  "Актуальная редакция выбрана неверно",
  "Есть согласованное изменение",
  "Ошибка OCR",
  "Ошибка привязки доказательства",
  "Параметр неприменим",
] as const;

const actionLabels: Record<ReviewAction, string> = {
  [FindingStatus.CONFIRMED_VIOLATION]: "Подтвердить нарушение",
  [FindingStatus.NEGATIVE_VERIFIED]: "Отклонить",
  [FindingStatus.CLARIFICATION_REQUIRED]: "Требует уточнения",
};

interface DiscrepancyDetailsProps {
  actualDocument: VerificationDocument;
  currentIndex: number;
  expectedDocument: VerificationDocument;
  finding: VerificationFinding;
  onDecision: (decision: VerificationFindingDecision) => void;
  onNext: () => void;
  onPrevious: () => void;
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
  document: VerificationDocument;
  evidence: VerificationFinding["expectedEvidence"];
  label: string;
}) {
  return (
    <article className="border-border min-w-0 border-l pl-4 first:border-l-0 first:pl-0">
      <p className="text-copy-muted text-xs font-medium">{label}</p>
      <h4 className="mt-1 text-sm font-semibold break-words">
        {document.title}
      </h4>
      <dl className="text-copy-muted mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt>Стадия</dt>
        <dd className="text-foreground">{document.stage}</dd>
        <dt>Шифр</dt>
        <dd className="text-foreground break-all">{document.cipher}</dd>
        <dt>Редакция</dt>
        <dd className="text-foreground">{document.revision}</dd>
        <dt>Изменение</dt>
        <dd className="text-foreground">{document.changeReference}</dd>
        <dt>Статус</dt>
        <dd className="text-foreground">{document.approvalStatus}</dd>
        <dt>Источник</dt>
        <dd className="text-foreground">
          {evidence.location}, стр. {evidence.page}
        </dd>
      </dl>
      <blockquote className="bg-surface-high text-foreground mt-3 rounded-xl px-3 py-2 text-xs leading-5">
        {evidence.excerpt}
      </blockquote>
    </article>
  );
}

export function DiscrepancyDetails({
  actualDocument,
  currentIndex,
  expectedDocument,
  finding,
  onDecision,
  onNext,
  onPrevious,
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
  const activeTab =
    tabState.findingId === finding.id ? tabState.tab : "comparison";
  const currentDraft =
    reviewDraft?.findingId === finding.id ? reviewDraft : null;
  const marker = markerPresentation[finding.uiMarker];

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
    const button =
      action === FindingStatus.CONFIRMED_VIOLATION
        ? confirmButtonRef.current
        : action === FindingStatus.NEGATIVE_VERIFIED
          ? rejectButtonRef.current
          : clarifyButtonRef.current;

    queueMicrotask(() => button?.focus());
  };

  const closeReview = () => {
    if (!currentDraft) return;

    const { action } = currentDraft;
    setReviewDraft(null);
    focusActionButton(action);
  };

  const submitReview = () => {
    if (!currentDraft) return;

    try {
      if (currentDraft.action === FindingStatus.NEGATIVE_VERIFIED) {
        onDecision({
          findingStatus: FindingStatus.NEGATIVE_VERIFIED,
          reason: currentDraft.reason,
          comment: currentDraft.comment,
        });
      } else {
        onDecision({
          findingStatus: currentDraft.action,
          comment: currentDraft.comment,
        });
      }
      closeReview();
    } catch (caughtError) {
      setReviewDraft((draft) =>
        draft?.findingId === finding.id
          ? {
              ...draft,
              error:
                caughtError instanceof Error
                  ? caughtError.message
                  : "Не удалось применить демонстрационное решение.",
            }
          : draft,
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
    if (key === "comparison" || key === "rationale" || key === "documents") {
      setTabState({ findingId: finding.id, tab: key });
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

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              className="rounded-xl"
              onPress={() => startReview(FindingStatus.CONFIRMED_VIOLATION)}
              ref={confirmButtonRef}
              size="sm"
            >
              Подтвердить нарушение
            </Button>
            <Button
              className="rounded-xl"
              onPress={() => startReview(FindingStatus.NEGATIVE_VERIFIED)}
              ref={rejectButtonRef}
              size="sm"
              variant="outline"
            >
              Отклонить
            </Button>
            <Button
              className="rounded-xl"
              onPress={() => startReview(FindingStatus.CLARIFICATION_REQUIRED)}
              ref={clarifyButtonRef}
              size="sm"
              variant="outline"
            >
              Требует уточнения
            </Button>
          </div>
        </div>

        {currentDraft ? (
          <div className="border-border bg-surface-low mt-4 rounded-[16px] border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {actionLabels[currentDraft.action]}
                </h3>
                <p className="text-copy-muted mt-1 text-xs">
                  Это действие изменит только локальные синтетические данные.
                </p>
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
              <Button onPress={submitReview} size="sm">
                Сохранить демо-решение
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
              <div className="bg-surface-high min-w-0 rounded-[16px] p-4">
                <h3 className="text-sm font-semibold">Последствия</h3>
                <ul className="text-copy-muted mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                  {finding.consequences.map((consequence) => (
                    <li key={consequence}>{consequence}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-surface-high min-w-0 rounded-[16px] p-4 min-[880px]:col-span-2 min-[1320px]:col-span-1">
                <h3 className="text-sm font-semibold">Рекомендации</h3>
                <p className="text-copy-muted mt-2 text-xs leading-5">
                  {finding.recommendation}
                </p>
              </div>
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
        </Tabs>
      </div>
    </section>
  );
}
