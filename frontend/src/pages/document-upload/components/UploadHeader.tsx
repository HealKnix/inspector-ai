import { Button, Popover } from "@heroui/react";

import { UploadIcon } from "@/components/UploadIcon";
import { PageHeader } from "@/layouts/ConstrainedLayout";

function HowItWorksPopover() {
  return (
    <Popover>
      <Button className="rounded-xl" variant="outline">
        <UploadIcon className="size-4.5" name="play" />
        Как это работает
      </Button>
      <Popover.Content className="border-border bg-popover max-w-80 rounded-2xl border p-0 shadow-xl">
        <Popover.Dialog className="p-4 outline-none">
          <Popover.Heading className="font-semibold">
            Четыре шага подготовки
          </Popover.Heading>
          <ol className="text-copy-muted mt-3 space-y-2 text-sm leading-5">
            <li>1. Добавьте PDF, DOCX и XML.</li>
            <li>2. Проверьте автоматически найденные метаданные.</li>
            <li>3. Оцените комплектность по доступным источникам.</li>
            <li>4. Передайте комплект на асинхронную обработку.</li>
          </ol>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function StructurePopover() {
  return (
    <Popover>
      <Button className="rounded-xl" variant="outline">
        <UploadIcon className="size-4.5" name="template" />
        Структура ПД / РД / ИД
      </Button>
      <Popover.Content className="border-border bg-popover max-w-96 rounded-2xl border p-0 shadow-xl">
        <Popover.Dialog className="p-4 outline-none">
          <Popover.Heading className="font-semibold">
            Что можно добавить
          </Popover.Heading>
          <dl className="mt-3 grid grid-cols-[36px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-semibold">ПД</dt>
            <dd className="text-copy-muted">Проектная документация</dd>
            <dt className="font-semibold">РД</dt>
            <dd className="text-copy-muted">Рабочая документация</dd>
            <dt className="font-semibold">ИД</dt>
            <dd className="text-copy-muted">Исполнительная документация</dd>
          </dl>
          <p className="text-copy-muted border-border mt-3 border-t pt-3 text-xs leading-5">
            Ожидаемый состав зависит от объекта. В демонстрационном наборе
            ведомость состава не подключена.
          </p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

interface UploadHeaderProps {
  fixtureNotice: string;
}

export function UploadHeader({ fixtureNotice }: UploadHeaderProps) {
  return (
    <PageHeader
      actions={
        <>
          <HowItWorksPopover />
          <StructurePopover />
        </>
      }
      description="Добавьте ПД, РД и ИД — система определит стадию, раздел, шифр и редакцию."
      notice={fixtureNotice}
      noticeLabel="ДЕМО"
      title="Загрузка комплекта документов"
    />
  );
}
