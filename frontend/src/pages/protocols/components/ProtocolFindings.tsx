import { Label, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";

import type { ProtocolRecord } from "@/types/protocols";

import { filterProtocolViolations } from "../lib/protocols";

type ProtocolViolation = ProtocolRecord["violations"][number];

interface ProtocolFindingsProps {
  violations: ProtocolRecord["violations"];
}

function DecisionBadge({ decision }: { decision: string }) {
  return (
    <span className="bg-success/10 text-success inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-5 font-medium whitespace-nowrap">
      <span aria-hidden="true">✓</span>
      {decision}
    </span>
  );
}

function MobileViolationCard({ violation }: { violation: ProtocolViolation }) {
  return (
    <article className="border-border border-b px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-copy-muted text-xs tabular-nums">
            № {violation.ordinal} · {violation.section}
          </p>
          <h3 className="mt-1 text-sm leading-5 font-semibold">
            {violation.parameter}
          </h3>
          <p className="text-copy-muted mt-1 font-mono text-xs">
            {violation.code}
          </p>
        </div>
        <DecisionBadge decision={violation.inspectorDecision} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-2 text-xs leading-5 min-[420px]:grid-cols-3">
        <div className="bg-surface-low rounded-xl p-2.5">
          <dt className="text-copy-muted">ПД</dt>
          <dd className="mt-1 break-words">{violation.pdValue}</dd>
        </div>
        <div className="bg-surface-low rounded-xl p-2.5">
          <dt className="text-copy-muted">РД</dt>
          <dd className="mt-1 break-words">{violation.rdValue}</dd>
        </div>
        <div className="bg-surface-low rounded-xl p-2.5">
          <dt className="text-copy-muted">ИД</dt>
          <dd className="mt-1 break-words">{violation.idValue}</dd>
        </div>
      </dl>

      <div className="border-border mt-3 border-t pt-3">
        <p className="text-copy-muted text-xs">Отклонение</p>
        <p className="text-danger mt-1 text-sm leading-5">
          {violation.deviation}
        </p>
      </div>
    </article>
  );
}

export function ProtocolFindings({ violations }: ProtocolFindingsProps) {
  const [query, setQuery] = useState("");
  const visibleViolations = useMemo(
    () =>
      filterProtocolViolations(violations, query).sort(
        (first, second) => first.ordinal - second.ordinal,
      ),
    [query, violations],
  );

  return (
    <section
      aria-labelledby="protocol-violations-title"
      className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
    >
      <div className="border-border flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:px-5">
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold" id="protocol-violations-title">
            Выявленные нарушения
          </h2>
          <p className="text-copy-muted mt-1 text-xs">
            Показано {visibleViolations.length} из {violations.length}
          </p>
        </div>
        <SearchField
          className="w-full sm:max-w-96"
          onChange={setQuery}
          value={query}
        >
          <Label className="sr-only">Поиск по нарушениям</Label>
          <SearchField.Group className="rounded-xl">
            <SearchField.SearchIcon />
            <SearchField.Input
              placeholder="Раздел, параметр, код или значение…"
              type="search"
            />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
      </div>

      <div className="hidden min-w-0 min-[1040px]:block">
        <Table className="rounded-none border-0 shadow-none">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Нарушения протокола"
              className="min-w-[1180px]"
            >
              <Table.Header>
                <Table.Column className="w-12">№</Table.Column>
                <Table.Column>Раздел</Table.Column>
                <Table.Column isRowHeader>Параметр (код)</Table.Column>
                <Table.Column>ПД</Table.Column>
                <Table.Column>РД</Table.Column>
                <Table.Column>ИД</Table.Column>
                <Table.Column>Отклонение</Table.Column>
                <Table.Column>Решение инспектора</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="text-copy-muted flex min-h-40 items-center justify-center px-6 text-center text-sm">
                    Нарушения по запросу не найдены
                  </div>
                )}
              >
                {visibleViolations.map((violation) => (
                  <Table.Row key={violation.id}>
                    <Table.Cell className="text-copy-muted tabular-nums">
                      {violation.ordinal}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block max-w-36 text-sm leading-5">
                        {violation.section}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="max-w-64 py-1">
                        <p className="text-sm leading-5 font-medium">
                          {violation.parameter}
                        </p>
                        <p className="text-copy-muted mt-1 font-mono text-xs">
                          {violation.code}
                        </p>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="max-w-40 text-sm leading-5">
                      {violation.pdValue}
                    </Table.Cell>
                    <Table.Cell className="max-w-40 text-sm leading-5">
                      {violation.rdValue}
                    </Table.Cell>
                    <Table.Cell className="max-w-40 text-sm leading-5">
                      {violation.idValue}
                    </Table.Cell>
                    <Table.Cell>
                      <p className="text-danger max-w-64 text-sm leading-5">
                        {violation.deviation}
                      </p>
                    </Table.Cell>
                    <Table.Cell>
                      <DecisionBadge decision={violation.inspectorDecision} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <div
        aria-label="Нарушения протокола на мобильном устройстве"
        className="min-[1040px]:hidden"
      >
        {visibleViolations.length === 0 ? (
          <p className="text-copy-muted px-5 py-10 text-center text-sm">
            Нарушения по запросу не найдены
          </p>
        ) : (
          visibleViolations.map((violation) => (
            <MobileViolationCard key={violation.id} violation={violation} />
          ))
        )}
      </div>
    </section>
  );
}
