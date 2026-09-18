import { ApiProperty } from "@nestjs/swagger";
import { ProcessStatus } from "../../generated/prisma/enums.js";

export class OriginalFileDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) object_id!: string;
  @ApiProperty({ format: "uuid" }) process_id!: string;
  @ApiProperty({ format: "uuid" }) run_id!: string;
  @ApiProperty() original_name!: string;
  @ApiProperty({ minimum: 0, maximum: 50_000_000 }) size!: number;
  @ApiProperty({ enum: ["PDF", "DOCX", "XML"] }) format!: string;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) sha256!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty() integrity_error!: boolean;
}
export class FileListDto {
  @ApiProperty({ type: [OriginalFileDto] }) items!: OriginalFileDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class ProcessDto {
  @ApiProperty({ enum: [1] }) schema_version!: number;
  @ApiProperty({ format: "uuid" }) object_id!: string;
  @ApiProperty({ format: "uuid" }) process_id!: string;
  @ApiProperty({ enum: ProcessStatus }) status!: ProcessStatus;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) run_id!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) input_manifest_hash!:
    string | null;
  @ApiProperty({ type: [String] }) allowed_actions!: string[];
}
