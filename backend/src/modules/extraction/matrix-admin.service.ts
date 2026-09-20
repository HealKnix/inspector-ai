import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { readClassificationConfig } from "../identification/classification-config.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import { contextWindows } from "./block-search.js";
import {
  PlanValidationError,
  validateExtractionPlan,
  type ExtractionPlan,
} from "./extraction-contract.js";
import { executePlan } from "./extraction-engine.js";
import {
  DRAFT_PROMPT_VERSION,
  draftPlanWithLlm,
  missingAnchors,
  planAnchorTerms,
} from "./extraction-llm.js";

interface ArtifactSource {
  file_id: string;
  original_name: string;
  artifact_id: string;
  artifact: ParseArtifactData;
}

@Injectable()
export class MatrixAdminService {
  private readonly llm;
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactStorageService,
    config: ConfigService,
  ) {
    // The OpenAI-compatible endpoint is shared with classification.
    this.llm = readClassificationConfig(config);
  }

  listRows() {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.matrixImport.findFirst({
        orderBy: { importedAt: "desc" },
      });
      const rows = source
        ? await tx.matrixRow.findMany({
            where: { importId: source.id },
            orderBy: { parameterId: "asc" },
          })
        : [];
      const rules = await tx.ruleVersion.groupBy({
        by: ["parameterCode", "status"],
        _count: { _all: true },
      });
      return {
        schema_version: 1,
        import: source,
        items: rows.map((row) => ({
          ...row,
          rule_counts: Object.fromEntries(
            rules
              .filter((entry) => entry.parameterCode === row.parameterCode)
              .map((entry) => [entry.status, entry._count._all]),
          ),
        })),
      };
    });
  }

  async getRow(parameterCode: string) {
    const row = await this.prisma.matrixRow.findFirst({
      where: { parameterCode },
      orderBy: { importId: "desc" },
    });
    if (!row) throw new NotFoundException("Строка матрицы не найдена");
    const versions = await this.prisma.ruleVersion.findMany({
      where: { parameterCode },
      orderBy: { version: "desc" },
    });
    return { schema_version: 1, row, versions };
  }

  async createDraft(
    context: { userId: string; requestId: string; ip?: string },
    parameterCode: string,
    input: { plan: unknown; note?: string },
  ) {
    let plan: ExtractionPlan;
    try {
      plan = validateExtractionPlan(input.plan);
    } catch (error) {
      throw new BadRequestException(
        error instanceof PlanValidationError
          ? error.message
          : "Некорректный план",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.matrixRow.findFirst({
        where: { parameterCode },
        orderBy: { importId: "desc" },
      });
      if (!row) throw new NotFoundException("Строка матрицы не найдена");
      const last = await tx.ruleVersion.findFirst({
        where: { parameterCode },
        orderBy: { version: "desc" },
      });
      const draft = await tx.ruleVersion.create({
        data: {
          parameterCode,
          parameterId: row.parameterId,
          version: (last?.version ?? 0) + 1,
          status: "draft",
          plan: JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue,
          note: input.note?.slice(0, 2000),
          createdBy: context.userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          action: "matrix.rule.draft_created",
          details: {
            schema_version: 1,
            parameter_code: parameterCode,
            rule_version_id: draft.id,
            version: draft.version,
          },
        },
      });
      return { schema_version: 1, rule: draft };
    });
  }

  /** Dry-run executes a draft plan on real parsed artifacts; nothing persists. */
  async dryRun(ruleId: string, input: { object_id: string; file_id?: string }) {
    const rule = await this.prisma.ruleVersion.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException("Версия правила не найдена");
    let plan: ExtractionPlan;
    try {
      plan = validateExtractionPlan(rule.plan);
    } catch {
      throw new UnprocessableEntityException(
        "Сохранённый план не проходит валидацию",
      );
    }
    const sources = await this.loadArtifacts(input.object_id, input.file_id);
    if (!sources.length)
      throw new NotFoundException(
        "Нет распарсенных артефактов для сухого прогона",
      );
    const results = sources.map((source) => ({
      file_id: source.file_id,
      original_name: source.original_name,
      artifact_id: source.artifact_id,
      outcome: executePlan(source.artifact, plan, {
        parameter_code: rule.parameterCode,
        rule_version_id: rule.id,
        version: rule.version,
        plan,
      }),
    }));
    return { schema_version: 1, rule_id: rule.id, results };
  }

  /** Bounded context windows for manual authoring and the drafting UI. */
  async search(input: {
    object_id: string;
    file_id?: string;
    terms: string[];
  }) {
    if (
      !Array.isArray(input.terms) ||
      input.terms.length === 0 ||
      input.terms.length > 16 ||
      input.terms.some(
        (term) => typeof term !== "string" || !term.trim() || term.length > 160,
      )
    )
      throw new BadRequestException("terms: 1..16 непустых строк");
    const sources = await this.loadArtifacts(input.object_id, input.file_id);
    if (!sources.length)
      throw new NotFoundException("Нет распарсенных артефактов для поиска");
    return {
      schema_version: 1,
      results: sources.map((source) => ({
        file_id: source.file_id,
        original_name: source.original_name,
        artifact_id: source.artifact_id,
        windows: contextWindows(source.artifact, input.terms),
      })),
    };
  }

  /**
   * LLM proposes a plan over real search windows; anchors that never occur in
   * the artifact reject the draft outright, partial misses become warnings.
   */
  async draftWithLlm(
    context: { userId: string; requestId: string; ip?: string },
    parameterCode: string,
    input: { object_id: string; file_id?: string; terms?: string[] },
  ) {
    if (!this.llm.enabled)
      throw new ConflictException(
        "LLM-контур выключен (CLASSIFICATION_LLM_ENABLED)",
      );
    const row = await this.prisma.matrixRow.findFirst({
      where: { parameterCode },
      orderBy: { importId: "desc" },
    });
    if (!row) throw new NotFoundException("Строка матрицы не найдена");
    const sources = await this.loadArtifacts(input.object_id, input.file_id);
    if (!sources.length)
      throw new NotFoundException("Нет распарсенных артефактов для черновика");
    const terms =
      input.terms?.filter((term) => typeof term === "string" && term.trim()) ??
      [row.name, row.unit ?? "", "показател"].filter(Boolean);
    const windows = sources.flatMap((source) =>
      contextWindows(source.artifact, terms).map((window) => ({
        ...window,
        file_id: source.file_id,
      })),
    );
    if (!windows.length)
      throw new UnprocessableEntityException(
        "Поиск не нашёл фрагментов по терминам; уточните terms",
      );
    const plan = await draftPlanWithLlm(
      {
        parameter: {
          parameter_code: row.parameterCode,
          name: row.name,
          unit: row.unit,
          source_pd: row.sourcePd,
          source_rd: row.sourceRd,
          source_id: row.sourceId,
          trigger: row.triggerText,
        },
        windows: windows.slice(0, 16),
      },
      this.llm,
    );
    const artifactForCheck = sources[0]!.artifact;
    const missing = missingAnchors(plan, artifactForCheck);
    const total = planAnchorTerms(plan).length;
    if (total > 0 && missing.length === total)
      throw new UnprocessableEntityException(
        `Черновик отклонён: якоря не встречаются в документе (${missing.join(", ")})`,
      );
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.ruleVersion.findFirst({
        where: { parameterCode },
        orderBy: { version: "desc" },
      });
      const draft = await tx.ruleVersion.create({
        data: {
          parameterCode,
          parameterId: row.parameterId,
          version: (last?.version ?? 0) + 1,
          status: "draft",
          plan: JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue,
          note: JSON.stringify({
            origin: "llm_draft",
            prompt_version: DRAFT_PROMPT_VERSION,
            model: this.llm.model,
            object_id: input.object_id,
            file_ids: sources.map((source) => source.file_id),
            missing_anchors: missing,
          }).slice(0, 2000),
          createdBy: context.userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          action: "matrix.rule.llm_draft_created",
          details: {
            schema_version: 1,
            parameter_code: parameterCode,
            rule_version_id: draft.id,
            version: draft.version,
            model: this.llm.model,
            missing_anchors: missing,
          },
        },
      });
      return {
        schema_version: 1,
        rule: draft,
        warnings: missing.length
          ? [`Якоря без совпадений в этом документе: ${missing.join(", ")}`]
          : [],
      };
    });
  }

  async approve(
    context: { userId: string; requestId: string; ip?: string },
    ruleId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.ruleVersion.findUnique({ where: { id: ruleId } });
      if (!rule) throw new NotFoundException("Версия правила не найдена");
      if (rule.status !== "draft")
        throw new ConflictException("Утвердить можно только черновик");
      try {
        validateExtractionPlan(rule.plan);
      } catch {
        throw new UnprocessableEntityException(
          "Сохранённый план не проходит валидацию",
        );
      }
      await tx.ruleVersion.updateMany({
        where: { parameterCode: rule.parameterCode, status: "approved" },
        data: { status: "deprecated", approvedBy: null, approvedAt: null },
      });
      const approved = await tx.ruleVersion.update({
        where: { id: rule.id },
        data: {
          status: "approved",
          approvedBy: context.userId,
          approvedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          action: "matrix.rule.approved",
          details: {
            schema_version: 1,
            parameter_code: rule.parameterCode,
            rule_version_id: rule.id,
            version: rule.version,
          },
        },
      });
      return { schema_version: 1, rule: approved };
    });
  }

  async reject(
    context: { userId: string; requestId: string; ip?: string },
    ruleId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.ruleVersion.findUnique({ where: { id: ruleId } });
      if (!rule) throw new NotFoundException("Версия правила не найдена");
      if (rule.status !== "draft")
        throw new ConflictException("Отклонить можно только черновик");
      const rejected = await tx.ruleVersion.update({
        where: { id: rule.id },
        data: { status: "rejected" },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          action: "matrix.rule.rejected",
          details: {
            schema_version: 1,
            parameter_code: rule.parameterCode,
            rule_version_id: rule.id,
          },
        },
      });
      return { schema_version: 1, rule: rejected };
    });
  }

  /**
   * Current parsed artifacts of the object's active process — the same "latest
   * succeeded cycle per file" rule the extraction worker executes against.
   */
  private async loadArtifacts(
    objectId: string,
    fileId?: string,
  ): Promise<ArtifactSource[]> {
    const rows = await this.prisma.$queryRaw<
      {
        file_id: string;
        original_name: string;
        artifact_id: string;
        storage_key: string;
        artifact_sha256: string;
        source_sha256: string;
        pipeline_fingerprint: string;
      }[]
    >`
      SELECT f.id AS file_id, f.original_name, a.id AS artifact_id,
             a.storage_key, a.artifact_sha256, a.source_sha256,
             a.pipeline_fingerprint
      FROM processes p
      JOIN runs r ON r.process_id = p.id AND r.version = p.version
      JOIN run_inputs ri ON ri.run_id = r.id
      JOIN files f ON f.id = ri.file_id
      JOIN LATERAL (
        SELECT id FROM parsing_tasks pt
        WHERE pt.run_id = r.id AND pt.file_id = f.id AND pt.state = 'succeeded'
        ORDER BY pt.cycle DESC LIMIT 1
      ) t ON true
      JOIN parse_artifacts a ON a.task_id = t.id AND a.source_sha256 = f.sha256
      WHERE p.object_id = ${objectId}::uuid AND f.corrupted_at IS NULL
        AND (${fileId ?? null}::uuid IS NULL OR f.id = ${fileId ?? null}::uuid)
      ORDER BY f.original_name`;
    const sources: ArtifactSource[] = [];
    for (const row of rows) {
      const artifact = await this.artifacts.read(
        row.storage_key,
        row.artifact_sha256,
        row.source_sha256,
        row.pipeline_fingerprint,
        "stored",
      );
      sources.push({
        file_id: row.file_id,
        original_name: row.original_name,
        artifact_id: row.artifact_id,
        artifact,
      });
    }
    return sources;
  }
}
