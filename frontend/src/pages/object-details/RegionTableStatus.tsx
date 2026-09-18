import type { PageRegion } from "@/api/types/parsing";
export function RegionTableStatus({ region }: { region: PageRegion }) {
  if (region.table_status === "unconfirmed")
    return (
      <p className="text-warning text-xs leading-5">
        Структура таблицы не подтверждена. Доступный текст сохранён в области;
        сверьте его с оригиналом.
      </p>
    );
  if (region.table_status === "unreadable")
    return (
      <p className="text-warning text-xs leading-5">
        Не удалось прочитать содержимое таблицы. Это не означает, что её ячейки
        пусты.
      </p>
    );
  return null;
}
