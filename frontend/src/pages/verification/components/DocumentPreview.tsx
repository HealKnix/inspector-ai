import type {
  VerificationDocument,
  VerificationEvidence,
} from "@/pages/verification/types";

interface DocumentPreviewProps {
  document: VerificationDocument;
  evidence?: VerificationEvidence;
  page: number;
  zoom: 75 | 100 | 125 | 150;
}

interface PreviewContentProps {
  document: VerificationDocument;
  evidence?: VerificationEvidence;
  page: number;
}

const zoomClassName = {
  75: "[zoom:0.75]",
  100: "[zoom:1]",
  125: "[zoom:1.25]",
  150: "[zoom:1.5]",
} as const;

function DocumentPage({
  children,
  document,
  evidence,
  page,
}: {
  children: React.ReactNode;
  document: VerificationDocument;
  evidence?: VerificationEvidence;
  page: number;
}) {
  const showsSelectedEvidence = evidence?.page === page;

  return (
    <article
      aria-label={`Предпросмотр файла ${document.fileName}`}
      className="border-line bg-card text-card-foreground mx-auto min-h-[570px] w-full border shadow-sm"
    >
      <header className="border-line flex items-start justify-between gap-6 border-b px-7 py-5">
        <div>
          <p className="text-copy-muted text-[10px] font-semibold tracking-[0.14em] uppercase">
            Синтетический демонстрационный документ
          </p>
          <p className="mt-1.5 text-sm font-semibold">{document.cipher}</p>
        </div>
        <div className="text-copy-muted text-right text-[10px] leading-4">
          <p>{document.revision}</p>
          <p>
            {document.stage} · стр. {page} из {document.totalPages}
          </p>
        </div>
      </header>
      <div
        className={
          showsSelectedEvidence
            ? "border-accent/20 bg-accent/5 mx-7 mt-5 rounded-xl border px-3 py-2.5"
            : "border-line bg-surface-low mx-7 mt-5 rounded-xl border px-3 py-2.5"
        }
        role="note"
      >
        {showsSelectedEvidence && evidence ? (
          <>
            <p className="text-accent text-[10px] font-semibold tracking-[0.1em] uppercase">
              Выбранное доказательство · {evidence.location}
            </p>
            <p className="mt-1 text-sm font-semibold break-words">
              {evidence.value}
            </p>
            <p className="text-copy-muted mt-1 text-xs leading-5">
              {evidence.excerpt}
            </p>
          </>
        ) : evidence ? (
          <p className="text-copy-muted text-xs leading-5">
            Открыта страница {page}. Фрагмент выбранного расхождения находится
            на странице {evidence.page}.
          </p>
        ) : (
          <p className="text-copy-muted text-xs leading-5">
            Синтетическое представление страницы {page}; для этого документа
            расхождение не выбрано.
          </p>
        )}
      </div>
      {children}
      <footer className="border-line text-copy-muted mx-7 mt-7 flex justify-between border-t py-3 text-[10px]">
        <span>{document.fileName}</span>
        <span>Данные синтетические</span>
      </footer>
    </article>
  );
}

function RequirementsPreview({
  document,
  evidence,
  page,
}: PreviewContentProps) {
  const selectedExcerpt = evidence?.page === page ? evidence.excerpt : null;

  return (
    <DocumentPage document={document} evidence={evidence} page={page}>
      <div className="px-7 py-7">
        <p className="text-copy-muted text-xs font-medium">Раздел 4.2</p>
        <h3 className="mt-1 text-lg font-semibold">{document.heading}</h3>

        <div className="text-copy-muted mt-6 space-y-3 text-sm leading-6">
          <p>
            <span className="text-foreground font-semibold">4.2.1.</span>{" "}
            Применяемые конструкции должны соответствовать демонстрационным
            параметрам комплекта и согласованным исходным данным.
          </p>
          <p className="bg-warning/10 text-foreground rounded-lg px-3 py-2.5">
            <span className="font-semibold">4.2.2.</span>{" "}
            {selectedExcerpt ?? document.highlight}
          </p>
          <p>
            <span className="text-foreground font-semibold">4.2.3.</span>{" "}
            Сечения и масса элементов сопоставляются с данными проверяемого
            массива документов.
          </p>
          <p>
            <span className="text-foreground font-semibold">4.2.4.</span>{" "}
            Защитное покрытие должно быть явно отражено в документации.
          </p>
        </div>

        <p className="text-copy-muted mt-7 text-xs font-medium">
          Таблица 4.1 — Демонстрационные параметры конструкций
        </p>
        <div className="border-line mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[420px] border-collapse text-left text-xs">
            <thead className="bg-surface-high text-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Элемент</th>
                <th className="px-3 py-2.5 font-medium">Сечение</th>
                <th className="px-3 py-2.5 font-medium">Материал</th>
                <th className="px-3 py-2.5 font-medium">Масса</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              <tr className="bg-warning/5">
                <td className="px-3 py-2.5 font-medium">Балка Д1</td>
                <td className="px-3 py-2.5">4051</td>
                <td className="px-3 py-2.5">C245</td>
                <td className="px-3 py-2.5">493</td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium">Балка Д2</td>
                <td className="px-3 py-2.5">3051</td>
                <td className="px-3 py-2.5">C245</td>
                <td className="px-3 py-2.5">355</td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium">Балка Д3</td>
                <td className="px-3 py-2.5">12551</td>
                <td className="px-3 py-2.5">C245</td>
                <td className="px-3 py-2.5">298</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DocumentPage>
  );
}

function DrawingPreview({ document, evidence, page }: PreviewContentProps) {
  const highlightedValue =
    (evidence?.page === page ? evidence.value.match(/C\d+/)?.[0] : null) ??
    document.highlight.match(/C\d+/)?.[0] ??
    "C255";

  return (
    <DocumentPage document={document} evidence={evidence} page={page}>
      <div className="px-7 py-7">
        <p className="text-copy-muted text-xs font-medium">Лист 12</p>
        <h3 className="mt-1 text-lg font-semibold">{document.heading}</h3>

        <div className="border-line bg-surface-low mt-5 rounded-xl border p-4">
          <svg
            aria-label="Демонстрационный чертёж опорной балки"
            className="text-foreground h-auto w-full"
            role="img"
            viewBox="0 0 620 260"
          >
            <g fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M62 104h398v62H62z" />
              <path d="M62 113h398M62 157h398" opacity=".45" />
              <path d="M70 91V57m382 34V57M70 70h382" opacity=".6" />
              <path d="m70 70 9-5v10zM452 70l-9-5v10z" fill="currentColor" />
              <path d="M48 104H28m20 62H28M38 104v62" opacity=".6" />
              <path d="m38 104-5 9h10zM38 166l-5-9h10z" fill="currentColor" />
              <path d="M474 99h105M474 171h105M550 99v72" opacity=".6" />
              <path d="m550 99-5 9h10zM550 171l-5-9h10z" fill="currentColor" />
              <path d="M498 112h76M536 112v46M498 158h76" strokeWidth="6" />
              <path d="m266 105 24-37h67" opacity=".7" />
            </g>
            <g fill="currentColor" fontFamily="inherit" fontSize="15">
              <text x="242" y="58" textAnchor="middle">
                6000
              </text>
              <text x="15" y="140">
                400
              </text>
              <text x="540" y="91" textAnchor="middle">
                A–A
              </text>
              <text x="558" y="139">
                400
              </text>
              <text x="305" y="62">
                4051
              </text>
            </g>
            <g className="text-danger" fill="currentColor">
              <rect height="34" rx="8" width="67" x="352" y="52" />
            </g>
            <text
              className="text-destructive-foreground"
              fill="currentColor"
              fontFamily="inherit"
              fontSize="14"
              fontWeight="700"
              textAnchor="middle"
              x="385.5"
              y="74"
            >
              {highlightedValue}
            </text>
          </svg>
        </div>

        <p className="text-danger mt-3 text-xs font-medium">
          {document.highlight}
        </p>

        <div className="border-line mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[420px] border-collapse text-left text-xs">
            <thead className="bg-surface-high text-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Параметр</th>
                <th className="px-3 py-2.5 font-medium">Значение</th>
                <th className="px-3 py-2.5 font-medium">Ед. изм.</th>
                <th className="px-3 py-2.5 font-medium">Примечание</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              <tr>
                <td className="px-3 py-2.5 font-medium">Материал</td>
                <td className="text-danger px-3 py-2.5 font-semibold">
                  {highlightedValue}
                </td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5">Демо</td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium">Масса</td>
                <td className="px-3 py-2.5">2,8</td>
                <td className="px-3 py-2.5">т</td>
                <td className="px-3 py-2.5">—</td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium">Длина</td>
                <td className="px-3 py-2.5">6000</td>
                <td className="px-3 py-2.5">мм</td>
                <td className="px-3 py-2.5">Демо</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DocumentPage>
  );
}

function TablePreview({ document, evidence, page }: PreviewContentProps) {
  return (
    <DocumentPage document={document} evidence={evidence} page={page}>
      <div className="px-7 py-7">
        <p className="text-copy-muted text-xs font-medium">
          Демонстрационная ведомость
        </p>
        <h3 className="mt-1 text-lg font-semibold">{document.heading}</h3>
        <p className="bg-warning/10 mt-5 rounded-lg px-3 py-2.5 text-sm leading-6">
          {document.highlight}
        </p>

        <div className="border-line mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[420px] border-collapse text-left text-xs">
            <thead className="bg-surface-high text-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">№</th>
                <th className="px-3 py-2.5 font-medium">Наименование</th>
                <th className="px-3 py-2.5 font-medium">Шифр</th>
                <th className="px-3 py-2.5 font-medium">Значение</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {[
                ["01", "Опорная балка Д1", "ДЕМО-КР-01", "C245"],
                ["02", "Опорная балка Д2", "ДЕМО-КР-02", "C245"],
                ["03", "Связь вертикальная", "ДЕМО-КР-03", "C255"],
                ["04", "Колонна демонстрационная", "ДЕМО-КР-04", "C245"],
              ].map((row, index) => (
                <tr key={row[0]} className={index === 2 ? "bg-warning/5" : ""}>
                  {row.map((cell, cellIndex) => (
                    <td
                      className={`px-3 py-3 ${cellIndex === 1 ? "font-medium" : ""}`}
                      key={cell}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DocumentPage>
  );
}

function FallbackPreview({ document, evidence, page }: PreviewContentProps) {
  return (
    <DocumentPage document={document} evidence={evidence} page={page}>
      <div className="grid min-h-[420px] place-items-center px-7 py-12 text-center">
        <div className="max-w-sm">
          <div className="bg-surface-high text-copy-muted mx-auto grid size-16 place-items-center rounded-2xl text-2xl font-semibold">
            {document.stage}
          </div>
          <h3 className="mt-5 text-lg font-semibold">{document.heading}</h3>
          <p className="text-copy-muted mt-2 text-sm leading-6">
            Для этого синтетического документа используется универсальное
            представление. {document.highlight}
          </p>
        </div>
      </div>
    </DocumentPage>
  );
}

export function DocumentPreview({
  document,
  evidence,
  page,
  zoom,
}: DocumentPreviewProps) {
  const contentProps = { document, evidence, page };

  return (
    <div
      className={`mx-auto w-full max-w-[760px] origin-top transition-[zoom] duration-200 ${zoomClassName[zoom]}`}
    >
      {document.previewKind === "requirements" ? (
        <RequirementsPreview {...contentProps} />
      ) : document.previewKind === "drawing" ? (
        <DrawingPreview {...contentProps} />
      ) : document.previewKind === "table" ? (
        <TablePreview {...contentProps} />
      ) : (
        <FallbackPreview {...contentProps} />
      )}
    </div>
  );
}
