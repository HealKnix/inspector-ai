import type { OpenAPIObject } from "@nestjs/swagger";

type Schema = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];
const hash: Schema = { type: "string", pattern: "^[0-9a-f]{64}$" };
const quality: Schema = {
  type: "string",
  enum: ["OK", "LOW_QUALITY", "ABSTAIN"],
  description: "Качество извлечения; не результат проверки документа",
};
const reasons: Schema = {
  type: "array",
  maxItems: 100,
  items: { type: "string", maxLength: 128 },
};
const nullableText: Schema = { type: "string", nullable: true };
const nullableIndex: Schema = { type: "integer", minimum: 0, nullable: true };
const bbox: Schema = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "number", minimum: 0, maximum: 1 },
  description:
    "x0,y0,x1,y1 относительно видимой области страницы после CropBox/Rotate; x0<x1, y0<y1",
};
const affine: Schema = {
  type: "array",
  minItems: 6,
  maxItems: 6,
  items: { type: "number" },
  description: "Шесть коэффициентов аффинного преобразования [a,b,c,d,e,f]",
};
const pdfBox: Schema = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "number" },
};
const transform: Schema = {
  type: "object",
  required: ["renderer", "coordinate_space", "render_width", "render_height"],
  properties: {
    renderer: { type: "string" },
    coordinate_space: { type: "string", enum: ["visible-page-normalized"] },
    render_width: { type: "integer", minimum: 1 },
    render_height: { type: "integer", minimum: 1 },
    media_box: pdfBox,
    crop_box: pdfBox,
    rotation: { type: "integer", enum: [0, 90, 180, 270] },
    pdf_to_visible: {
      ...affine,
      description:
        "Координаты исходного PDF → точки видимой области после CropBox/Rotate; для bbox разделить x/y на visible_width_points/visible_height_points",
    },
    visible_to_pdf: {
      ...affine,
      description:
        "Точки видимой области → координаты исходного PDF; bbox [0,1] сначала умножить на visible_width_points/visible_height_points",
    },
    visible_width_points: { type: "number", minimum: 0 },
    visible_height_points: { type: "number", minimum: 0 },
    structural_mapping: { type: "boolean" },
    font_sha256: hash,
    layout: { type: "string" },
    ocr_regions: {
      type: "array",
      items: {
        type: "object",
        required: ["bbox", "rotation"],
        properties: { bbox, rotation: { type: "number" } },
      },
    },
  },
  oneOf: [
    {
      required: ["structural_mapping", "font_sha256", "layout"],
      properties: { structural_mapping: { type: "boolean", enum: [true] } },
    },
    {
      required: [
        "media_box",
        "crop_box",
        "rotation",
        "pdf_to_visible",
        "visible_to_pdf",
      ],
      properties: { structural_mapping: { type: "boolean", enum: [false] } },
    },
  ],
};
const block: Schema = {
  type: "object",
  required: [
    "id",
    "order",
    "kind",
    "raw_text",
    "normalized_text",
    "bbox",
    "confidence",
    "source",
    "structural_path",
    "table_id",
    "row",
    "column",
    "row_span",
    "column_span",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    order: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["text", "table_cell"] },
    raw_text: { type: "string" },
    normalized_text: { type: "string" },
    bbox,
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      nullable: true,
      description: "Оценка модели, не измеренная точность",
    },
    source: { type: "string", enum: ["native", "ocr", "structured"] },
    structural_path: nullableText,
    table_id: nullableText,
    row: nullableIndex,
    column: nullableIndex,
    row_span: { type: "integer", minimum: 1, nullable: true },
    column_span: { type: "integer", minimum: 1, nullable: true },
  },
};
export const parseArtifactSchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "source_sha256",
    "pipeline_fingerprint",
    "versions",
    "raw_text",
    "normalized_text",
    "quality",
    "reasons",
    "coverage",
    "pages",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    source_sha256: hash,
    pipeline_fingerprint: hash,
    versions: {
      type: "object",
      minProperties: 1,
      maxProperties: 64,
      additionalProperties: { type: "string" },
    },
    raw_text: { type: "string" },
    normalized_text: { type: "string" },
    quality,
    reasons,
    coverage: {
      type: "object",
      required: ["total_pages", "readable_pages", "unreadable_pages"],
      properties: {
        total_pages: { type: "integer", minimum: 1 },
        readable_pages: { type: "integer", minimum: 0 },
        unreadable_pages: { type: "integer", minimum: 0 },
      },
    },
    pages: {
      type: "array",
      minItems: 1,
      maxItems: 10_000,
      items: {
        type: "object",
        required: [
          "page_number",
          "sheet_label",
          "width",
          "height",
          "image_key",
          "image_sha256",
          "quality",
          "reasons",
          "transform",
          "blocks",
        ],
        properties: {
          page_number: {
            type: "integer",
            minimum: 1,
            description: "Физическая страница, начиная с 1",
          },
          sheet_label: nullableText,
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
          image_key: {
            type: "string",
            format: "uuid",
            description:
              "Приватный UUID handle; публичный просмотр только через защищённый page endpoint",
          },
          image_sha256: hash,
          quality,
          reasons,
          transform,
          blocks: { type: "array", items: block },
        },
      },
    },
  },
};
