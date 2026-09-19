import { Button, Label, SearchField } from "@heroui/react";

interface VerificationHeaderProps {
  fixtureNotice: string;
  objectLabel: string;
  onQueryChange: (value: string) => void;
  query: string;
  sectionLabel: string;
}

export function VerificationHeader({
  fixtureNotice,
  objectLabel,
  onQueryChange,
  query,
  sectionLabel,
}: VerificationHeaderProps) {
  return (
    <header className="grid gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(520px,0.95fr)] min-[1180px]:items-end">
      <div className="min-w-0">
        <nav
          aria-label="Хлебные крошки"
          className="text-copy-muted flex min-w-0 items-center gap-2 text-xs sm:text-sm"
        >
          <span>Проверки</span>
          <span aria-hidden="true">/</span>
          <span className="truncate">{objectLabel}</span>
          <span aria-hidden="true">/</span>
          <span className="truncate">{sectionLabel}</span>
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(1.9rem,3vw,3rem)] leading-none font-semibold tracking-[-0.04em]">
            Проверка комплекта документов
          </h1>
          <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-xs font-semibold">
            Инспектор
          </span>
        </div>
        <div
          className="bg-accent/5 text-copy-muted mt-4 flex w-fit max-w-full items-center gap-2 rounded-xl px-3 py-2 text-xs leading-5"
          role="note"
        >
          <span className="bg-accent/10 text-accent shrink-0 rounded-md px-2 py-0.5 font-semibold">
            ДЕМО
          </span>
          <span className="truncate sm:whitespace-normal">{fixtureNotice}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(240px,0.8fr)_minmax(280px,1.2fr)]">
        <div className="min-w-0">
          <p className="text-copy-muted mb-1.5 text-xs">Объект проверки</p>
          <Button
            aria-label={`Выбран объект: ${objectLabel}`}
            className="w-full justify-between rounded-xl px-3"
            isDisabled
            variant="outline"
          >
            <span className="truncate">{objectLabel}</span>
            <span aria-hidden="true" className="text-copy-muted">
              ⌄
            </span>
          </Button>
        </div>

        <SearchField
          className="self-end"
          onChange={onQueryChange}
          value={query}
        >
          <Label className="sr-only">Поиск по расхождениям</Label>
          <SearchField.Group className="rounded-xl">
            <SearchField.SearchIcon />
            <SearchField.Input
              placeholder="Документ, параметр или значение…"
              type="search"
            />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
      </div>
    </header>
  );
}
