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
            Как проходит загрузка
          </Popover.Heading>
          <ol className="text-copy-muted mt-3 space-y-2 text-sm leading-5">
            <li>1. Выберите стадию документации и добавьте PDF, DOCX и XML.</li>
            <li>2. Отправьте пакет — сервер проверит и сохранит оригиналы.</li>
            <li>3. Дождитесь обработки: стадия определяется автоматически.</li>
            <li>4. Разберите документы, требующие уточнения.</li>
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
            Эталонный состав задаётся атрибутами при создании объекта; плашка
            «Комплектность» показывает загруженную долю по стадиям.
          </p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

interface UploadHeaderProps {
  backHref: string;
  objectName: string;
}

export function UploadHeader({ backHref, objectName }: UploadHeaderProps) {
  return (
    <PageHeader
      actions={
        <>
          <HowItWorksPopover />
          <StructurePopover />
        </>
      }
      backHref={backHref}
      backLabel="К объектам"
      description={
        <>
          Объект: <span className="text-foreground">{objectName}</span>.
          Выберите стадию и добавьте файлы — система проверит пакет, сохранит
          оригиналы и определит стадию каждого документа.
        </>
      }
      title="Загрузка комплекта документов"
    />
  );
}
