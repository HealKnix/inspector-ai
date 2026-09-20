import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateObjectDto {
  @ApiProperty({ maxLength: 300, example: "Жилой корпус 1" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ObjectDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() created_by!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
  @ApiProperty({ example: ["upload"] }) allowed_actions!: string[];
}

export class ObjectListDto {
  @ApiProperty({ type: [ObjectDto] }) items!: ObjectDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ example: ["create"] }) allowed_actions!: string[];
}
