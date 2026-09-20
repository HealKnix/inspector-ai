// Извлечение кандидатов объектных перечней из текста артефактов (задача 3.2).
// Результат — только предложение с источником: основанием перечень становится
// после подтверждения инспектором (D2). Якоря берутся из формулировки ТЗ
// §5 примечание 4: перечень скрытых работ, конструкций и участков сетей
// указывается в Общих данных.

export interface ExtractedItem {
  listKind: "hidden_works" | "structures" | "network_sections";
  itemKey: string;
  title: string;
  source: { file_id: string; page: number; quote: string };
}

interface TextLike {
  page_number: number;
  blocks: { raw_text: string; normalized_text: string }[];
}

const ANCHOR =
  /переч(?:е|ё)н[ья].{0,80}(скрытых|освидетельств)|освидетельствованию.{0,80}(скрытых|конструкц|сет)/i;
const ITEM_LINE = /^\s*(?:\d{1,2}[.)]\s*|[-–—]\s*)(\S.{3,200}?)\s*$/;
const STOP_LINE =
  /^\s*(?:\d{1,2}[.)]\s*)?[А-ЯЁ][А-ЯЁ\s]{4,}$|лист|раздел|общие данные|ведомость/i;

function classify(text: string): ExtractedItem["listKind"] {
  const lower = text.toLowerCase();
  if (
    /сет[ьи]|трубопровод|кабельн|водоснабж|канализац|вентиляц|электро/.test(
      lower,
    )
  )
    return "network_sections";
  if (
    /конструкц|элемент|каркас|балк|колонн|плита|фундамент|сва[иья]/.test(lower)
  )
    return "structures";
  return "hidden_works";
}

export function extractListItems(
  fileId: string,
  pages: TextLike[],
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const lines = page.blocks.flatMap((block) =>
      (block.normalized_text || block.raw_text).split(/\r?\n/),
    );
    for (let i = 0; i < lines.length; i++) {
      const anchorLine = lines[i];
      if (anchorLine === undefined || !ANCHOR.test(anchorLine)) continue;
      const quote = anchorLine.trim().slice(0, 200);
      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        const line = lines[j];
        if (line === undefined) break;
        if (STOP_LINE.test(line) && !/^\s*\d{1,2}[.)]/.test(line)) break;
        const match = ITEM_LINE.exec(line);
        if (!match) continue;
        const captured = match[1];
        if (captured === undefined) continue;
        const title = captured.trim();
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          listKind: classify(title),
          itemKey: title,
          title,
          source: { file_id: fileId, page: page.page_number, quote },
        });
      }
    }
  }
  return items;
}
