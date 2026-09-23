import { Button } from "@heroui/react";

import { Input } from "@/components/input/Input";
import { UploadIcon } from "@/components/UploadIcon";
import { PageHeader } from "@/layouts/ConstrainedLayout";

interface VerificationHeaderProps {
  canCreateProtocol: boolean;
  fixtureNotice: string;
  objectLabel: string;
  onCreateProtocol: () => void;
  onQueryChange: (value: string) => void;
  pendingCount: number;
  query: string;
  sectionLabel: string;
}

export function VerificationHeader({
  canCreateProtocol,
  fixtureNotice,
  objectLabel,
  onCreateProtocol,
  onQueryChange,
  pendingCount,
  query,
  sectionLabel,
}: VerificationHeaderProps) {
  return (
    <PageHeader
      actions={
        <div className="grid w-full gap-3 self-end min-[880px]:w-135 sm:grid-cols-[minmax(240px,0.8fr)_minmax(280px,1.2fr)]">
          <Input
            aria-label="Поиск по расхождениям"
            className="col-span-2 self-end"
            clearButtonLabel="Очистить поиск"
            onChange={onQueryChange}
            placeholder="Документ, параметр или значение…"
            type="search"
            value={query}
          />

          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end">
            <p
              className="text-copy-muted text-xs leading-5 sm:mr-auto"
              id="protocol-readiness"
            >
              {canCreateProtocol
                ? "Все расхождения обработаны — протокол готов к формированию."
                : `Осталось обработать расхождений: ${pendingCount}.`}
            </p>
            <Button
              aria-describedby="protocol-readiness"
              className="rounded-xl"
              isDisabled={!canCreateProtocol}
              onPress={onCreateProtocol}
            >
              <UploadIcon className="size-4.5" name="file" />
              Сформировать протокол
            </Button>
          </div>
        </div>
      }
      badge="Инспектор"
      breadcrumbs={["Проверки", objectLabel, sectionLabel]}
      notice={fixtureNotice}
      noticeLabel="ДЕМО"
      title="Проверка комплекта документов"
    />
  );
}
