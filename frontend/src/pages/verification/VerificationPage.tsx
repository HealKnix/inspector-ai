import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { mockProtocolViolations } from "@/data/protocols";
import { mockVerificationPackage } from "@/data/verification";
import {
  applyLocalFindingDecision,
  filterVerificationFindings,
  getVerificationSummary,
  sortVerificationFindings,
} from "@/pages/verification/lib/verification";
import {
  VerificationFindingSort,
  type VerificationDocument,
  type VerificationFindingDecision,
  type VerificationUiMarker,
} from "@/pages/verification/types";
import routeNames from "@/routes/routeNames";
import { useProtocolStore } from "@/store/protocols";

import { DiscrepancyDetails } from "./components/DiscrepancyDetails";
import { DiscrepancyList } from "./components/DiscrepancyList";
import { DocumentPane } from "./components/DocumentPane";
import { ObjectVerificationWorkspace } from "./components/ObjectVerificationWorkspace";
import { VerificationHeader } from "./components/VerificationHeader";

export function VerificationPage() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId")?.trim();

  return objectId ? (
    <ObjectVerificationWorkspace key={objectId} objectId={objectId} />
  ) : (
    <DemoVerificationPage />
  );
}

function DemoVerificationPage() {
  const navigate = useNavigate();
  const createProtocol = useProtocolStore((state) => state.createProtocol);
  const [findings, setFindings] = useState(() => [
    ...mockVerificationPackage.findings,
  ]);
  const [query, setQuery] = useState("");
  const [markerFilter, setMarkerFilter] = useState<
    VerificationUiMarker | "all"
  >("all");
  const [sortBy, setSortBy] = useState<VerificationFindingSort>(
    VerificationFindingSort.PRIORITY,
  );
  const [selectedId, setSelectedId] = useState(
    mockVerificationPackage.findings[0]?.id ?? "",
  );
  const initialFinding = mockVerificationPackage.findings[0];
  const leftSlot = mockVerificationPackage.viewerSlots[0];
  const rightSlot = mockVerificationPackage.viewerSlots[1];
  const [leftDocumentId, setLeftDocumentId] = useState<string>(
    initialFinding?.expectedEvidence.documentId ??
      leftSlot?.initialDocumentId ??
      "",
  );
  const [rightDocumentId, setRightDocumentId] = useState<string>(
    initialFinding?.actualEvidence.documentId ??
      rightSlot?.initialDocumentId ??
      "",
  );
  const [leftPage, setLeftPage] = useState(
    initialFinding?.expectedEvidence.page ?? leftSlot?.initialPage ?? 1,
  );
  const [rightPage, setRightPage] = useState(
    initialFinding?.actualEvidence.page ?? rightSlot?.initialPage ?? 1,
  );
  const [decisionMessage, setDecisionMessage] = useState("");

  const documentsById = useMemo(
    () =>
      new Map<string, VerificationDocument>(
        mockVerificationPackage.documents.map((document) => [
          document.id,
          document,
        ]),
      ),
    [],
  );
  const summary = useMemo(() => getVerificationSummary(findings), [findings]);
  const canCreateProtocol =
    summary.totalCount > 0 && summary.pendingCount === 0;
  const visibleFindings = useMemo(
    () =>
      sortVerificationFindings(
        filterVerificationFindings(
          findings,
          {
            query,
            uiMarker: markerFilter,
            findingStatus: "all",
            reviewPriority: "all",
          },
          mockVerificationPackage.documents,
        ),
        sortBy,
      ),
    [findings, markerFilter, query, sortBy],
  );
  const selectedFinding =
    visibleFindings.find((finding) => finding.id === selectedId) ??
    visibleFindings[0];

  if (!leftSlot || !rightSlot) {
    return (
      <div className="text-copy-muted grid h-full min-h-72 flex-1 place-items-center p-6 text-sm">
        Демонстрационные окна просмотра не настроены.
      </div>
    );
  }

  const leftDocuments = leftSlot.availableDocumentIds.flatMap((id) => {
    const document = documentsById.get(id);
    return document ? [document] : [];
  });
  const rightDocuments = rightSlot.availableDocumentIds.flatMap((id) => {
    const document = documentsById.get(id);
    return document ? [document] : [];
  });

  const selectFinding = (findingId: string) => {
    const finding = findings.find((candidate) => candidate.id === findingId);
    if (!finding) return;

    setSelectedId(finding.id);
    setLeftDocumentId(finding.expectedEvidence.documentId);
    setRightDocumentId(finding.actualEvidence.documentId);
    setLeftPage(finding.expectedEvidence.page);
    setRightPage(finding.actualEvidence.page);
    setDecisionMessage("");
  };

  const keepSelectionVisible = (
    nextQuery: string,
    nextMarkerFilter: VerificationUiMarker | "all",
  ) => {
    const nextVisibleFindings = sortVerificationFindings(
      filterVerificationFindings(
        findings,
        {
          query: nextQuery,
          uiMarker: nextMarkerFilter,
          findingStatus: "all",
          reviewPriority: "all",
        },
        mockVerificationPackage.documents,
      ),
      sortBy,
    );
    const nextSelection =
      nextVisibleFindings.find((finding) => finding.id === selectedId) ??
      nextVisibleFindings[0];

    if (nextSelection && nextSelection.id !== selectedId) {
      selectFinding(nextSelection.id);
    }
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    keepSelectionVisible(value, markerFilter);
  };

  const changeMarkerFilter = (value: VerificationUiMarker | "all") => {
    setMarkerFilter(value);
    keepSelectionVisible(query, value);
  };

  const navigateFinding = (direction: -1 | 1) => {
    if (!selectedFinding || visibleFindings.length < 2) return;

    const currentIndex = visibleFindings.findIndex(
      (finding) => finding.id === selectedFinding.id,
    );
    const nextIndex =
      (currentIndex + direction + visibleFindings.length) %
      visibleFindings.length;
    const nextFinding = visibleFindings[nextIndex];
    if (nextFinding) selectFinding(nextFinding.id);
  };

  const applyDecision = (decision: VerificationFindingDecision) => {
    if (!selectedFinding) return;

    const nextFindings = applyLocalFindingDecision(
      findings,
      selectedFinding.id,
      decision,
    );
    setFindings(nextFindings);
    setDecisionMessage(
      "Демонстрационное решение применено только в памяти этой страницы.",
    );
  };

  const handleCreateProtocol = () => {
    if (!canCreateProtocol) return;

    const protocol = createProtocol({
      checkedAt: new Date().toLocaleDateString("sv-SE"),
      findings,
      objectId: mockVerificationPackage.objectId,
      objectName: mockVerificationPackage.objectLabel,
      violations: mockProtocolViolations,
    });
    void navigate(routeNames.PROTOCOL_DETAILS(protocol.id));
  };

  const expectedDocument = selectedFinding
    ? documentsById.get(selectedFinding.expectedEvidence.documentId)
    : undefined;
  const actualDocument = selectedFinding
    ? documentsById.get(selectedFinding.actualEvidence.documentId)
    : undefined;
  const selectedVisibleIndex = selectedFinding
    ? visibleFindings.findIndex((finding) => finding.id === selectedFinding.id)
    : -1;

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full max-w-[1780px] px-4 py-5 min-[1400px]:px-6 sm:px-6 sm:py-7">
        <VerificationHeader
          canCreateProtocol={canCreateProtocol}
          fixtureNotice={mockVerificationPackage.fixtureNotice}
          objectLabel={mockVerificationPackage.objectLabel}
          onCreateProtocol={handleCreateProtocol}
          onQueryChange={changeQuery}
          pendingCount={summary.pendingCount}
          query={query}
          sectionLabel={mockVerificationPackage.sectionLabel}
        />

        <div className="mt-5 grid items-stretch gap-4 min-[1440px]:grid-cols-12">
          <div className="grid min-w-0 gap-4 min-[840px]:grid-cols-2 min-[1440px]:col-span-8">
            <DocumentPane
              className="h-[680px]"
              documentId={leftDocumentId}
              documents={leftDocuments}
              evidence={selectedFinding?.expectedEvidence}
              label={leftSlot.label}
              onDocumentChange={(document) => {
                setLeftDocumentId(document.id);
              }}
              onPageChange={setLeftPage}
              page={leftPage}
            />
            <DocumentPane
              className="h-[680px]"
              documentId={rightDocumentId}
              documents={rightDocuments}
              evidence={selectedFinding?.actualEvidence}
              label={rightSlot.label}
              onDocumentChange={(document) => {
                setRightDocumentId(document.id);
              }}
              onPageChange={setRightPage}
              page={rightPage}
            />
          </div>

          <div className="min-w-0 min-[1440px]:col-span-4">
            <DiscrepancyList
              findings={visibleFindings}
              markerFilter={markerFilter}
              onMarkerFilterChange={changeMarkerFilter}
              onQueryChange={changeQuery}
              onSelect={selectFinding}
              onSortChange={setSortBy}
              query={query}
              selectedId={selectedFinding?.id ?? ""}
              sortBy={sortBy}
              summary={summary}
            />
          </div>
        </div>

        {selectedFinding && expectedDocument && actualDocument ? (
          <div className="mt-4 pb-6">
            <DiscrepancyDetails
              actualDocument={actualDocument}
              currentIndex={Math.max(selectedVisibleIndex, 0)}
              expectedDocument={expectedDocument}
              finding={selectedFinding}
              onDecision={applyDecision}
              onNext={() => navigateFinding(1)}
              onPrevious={() => navigateFinding(-1)}
              totalCount={visibleFindings.length}
            />
            <p
              aria-live="polite"
              className="text-copy-muted mt-2 min-h-5 text-right text-xs"
              role="status"
            >
              {decisionMessage}
            </p>
          </div>
        ) : (
          <div className="border-border bg-card text-copy-muted mt-4 grid min-h-48 place-items-center rounded-[20px] border p-6 text-center text-sm">
            Выберите другие условия поиска, чтобы открыть карточку расхождения.
          </div>
        )}
      </div>
    </div>
  );
}
