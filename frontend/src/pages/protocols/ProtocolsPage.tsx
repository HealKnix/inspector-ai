import {
  Button,
  Label,
  ListBox,
  SearchField,
  Select,
  Table,
  type Key,
} from "@heroui/react";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { UploadIcon } from "@/components/UploadIcon";
import { PROTOCOL_FIXTURE_NOTICE } from "@/data/protocols";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";
import { useProtocolStore } from "@/store/protocols";

import { filterProtocols, formatProtocolDate } from "./lib/protocols";

const ALL_OBJECTS_KEY = "all";

function protocolTitle(checkedAt: string) {
  return `Протокол от ${formatProtocolDate(checkedAt)}`;
}

export function ProtocolsPage() {
  const protocols = useProtocolStore((state) => state.protocols);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const objectId = searchParams.get("objectId")?.trim() ?? "";
  const query = searchParams.get("q") ?? "";

  const objects = useMemo(() => {
    const objectsById = new Map<string, string>();
    for (const protocol of protocols) {
      objectsById.set(protocol.objectId, protocol.objectName);
    }
    return [...objectsById].map(([id, name]) => ({ id, name }));
  }, [protocols]);
  const visibleProtocols = useMemo(
    () => filterProtocols(protocols, objectId, query),
    [objectId, protocols, query],
  );

  const setSearchParam = (name: "objectId" | "q", value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const normalizedValue = value.trim();
        if (normalizedValue) next.set(name, normalizedValue);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  };

  const handleObjectChange = (key: Key | null) => {
    setSearchParam(
      "objectId",
      typeof key === "string" && key !== ALL_OBJECTS_KEY ? key : "",
    );
  };

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.ROOT}
        description="Сводные документы по завершённым демонстрационным проверкам. Выберите объект или найдите нужный протокол."
        notice={PROTOCOL_FIXTURE_NOTICE}
        noticeLabel="ДЕМО"
        title="Протоколы"
      />

      <section
        aria-labelledby="protocols-list-title"
        className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
      >
        <div className="border-border flex flex-col gap-4 border-b px-4 py-5 min-[920px]:flex-row sm:px-5">
          <div className="mr-auto min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" id="protocols-list-title">
                Все протоколы
              </h2>
              <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
                {visibleProtocols.length} из {protocols.length}
              </span>
            </div>
            <p className="text-copy-muted mt-1 text-xs">
              Откройте строку, чтобы посмотреть итоговую сводку и решения.
            </p>
          </div>

          <div className="grid w-full gap-3 min-[920px]:w-auto min-[920px]:grid-cols-[280px_300px] sm:grid-cols-2">
            <Select
              className="w-full"
              onChange={handleObjectChange}
              placeholder="Все объекты"
              value={objectId || ALL_OBJECTS_KEY}
            >
              <Label>Объект</Label>
              <Select.Trigger className="rounded-xl">
                <Select.Value className="max-w-full truncate" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="not-sm:max-w-0">
                <ListBox>
                  <ListBox.Item id={ALL_OBJECTS_KEY} textValue="Все объекты">
                    Все объекты
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {objects.map((object) => (
                    <ListBox.Item
                      id={object.id}
                      key={object.id}
                      textValue={object.name}
                      className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                    >
                      <p className="min-w-0 flex-1 truncate">{object.name}</p>
                      <ListBox.ItemIndicator className="text-accent" />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <SearchField
              onChange={(value) => setSearchParam("q", value)}
              value={query}
            >
              <Label>Поиск</Label>
              <SearchField.Group className="rounded-xl">
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Объект или дата…"
                  type="search"
                />
                <SearchField.ClearButton aria-label="Очистить поиск" />
              </SearchField.Group>
            </SearchField>
          </div>
        </div>

        <div className="hidden min-[861px]:block">
          <Table className="rounded-none border-0 shadow-none">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Протоколы проверок"
                className="min-w-[760px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>Протокол</Table.Column>
                  <Table.Column>Объект</Table.Column>
                  <Table.Column>Дата проверки</Table.Column>
                  <Table.Column>Нарушения</Table.Column>
                  <Table.Column>Состояние</Table.Column>
                  <Table.Column aria-label="Открыть протокол" />
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                      <UploadIcon
                        className="text-copy-muted mb-3 size-9"
                        name="file"
                      />
                      <h3 className="text-lg font-medium">
                        Протоколы не найдены
                      </h3>
                      <p className="text-copy-muted mt-2 text-sm">
                        Измените объект или поисковый запрос.
                      </p>
                      <Button
                        className="mt-4 rounded-xl"
                        onPress={clearFilters}
                        size="sm"
                        variant="outline"
                      >
                        Сбросить фильтры
                      </Button>
                    </div>
                  )}
                >
                  {visibleProtocols.map((protocol) => (
                    <Table.Row
                      className="data-[focus-visible-within]:[&_td]:bg-accent/10 data-[hovered=true]:[&_td]:bg-surface-high cursor-pointer outline-none [&_td]:transition-colors"
                      id={protocol.id}
                      key={protocol.id}
                      onAction={() => {
                        void navigate(routeNames.PROTOCOL_DETAILS(protocol.id));
                      }}
                      textValue={`${protocolTitle(protocol.checkedAt)}, ${protocol.objectName}`}
                    >
                      <Table.Cell>
                        <span className="flex items-center gap-3 py-2 font-medium">
                          <span className="bg-accent/10 text-accent grid size-10 shrink-0 place-items-center rounded-xl">
                            <UploadIcon className="size-5" name="file" />
                          </span>
                          {protocolTitle(protocol.checkedAt)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="max-w-md break-words">
                          {protocol.objectName}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-copy-muted whitespace-nowrap tabular-nums">
                        {formatProtocolDate(protocol.checkedAt)}
                      </Table.Cell>
                      <Table.Cell className="tabular-nums">
                        {protocol.violations.length}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="bg-accent/10 text-accent inline-flex rounded-full px-2.5 py-1 text-xs font-medium">
                          Сформирован
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-accent inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                          Открыть
                          <UploadIcon className="size-4" name="chevron-right" />
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>

        <div className="divide-border divide-y min-[861px]:hidden">
          {visibleProtocols.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <UploadIcon
                className="text-copy-muted mx-auto size-9"
                name="file"
              />
              <h3 className="mt-3 text-lg font-medium">Протоколы не найдены</h3>
              <p className="text-copy-muted mt-2 text-sm">
                Измените объект или поисковый запрос.
              </p>
              <Button
                className="mt-4 rounded-xl"
                onPress={clearFilters}
                size="sm"
                variant="outline"
              >
                Сбросить фильтры
              </Button>
            </div>
          ) : (
            visibleProtocols.map((protocol) => (
              <Link
                className="hover:bg-surface-high focus-visible:bg-accent/10 block px-4 py-4 outline-none sm:px-5"
                key={protocol.id}
                to={routeNames.PROTOCOL_DETAILS(protocol.id)}
              >
                <article>
                  <div className="flex items-start gap-3">
                    <span className="bg-accent/10 text-accent grid size-10 shrink-0 place-items-center rounded-xl">
                      <UploadIcon className="size-5" name="file" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold">
                          {protocolTitle(protocol.checkedAt)}
                        </h3>
                        <UploadIcon
                          className="text-accent mt-0.5 size-4 shrink-0"
                          name="chevron-right"
                        />
                      </div>
                      <p className="text-copy-muted mt-1 text-sm">
                        {protocol.objectName}
                      </p>
                      <div className="text-copy-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                        <span>{formatProtocolDate(protocol.checkedAt)}</span>
                        <span>{protocol.violations.length} нарушений</span>
                        <span className="bg-accent/10 text-accent rounded-full px-2 py-1 font-medium">
                          Сформирован
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              </Link>
            ))
          )}
        </div>
      </section>
    </ConstrainedLayout>
  );
}
