import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, type TransformFnParams } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";

import { Role } from "../../../generated/prisma/enums.js";

function normalizeRequiredText({ value }: TransformFnParams): unknown {
  return typeof value === "string" ? value.trim().normalize("NFC") : value;
}

function normalizeTextOrNull(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const normalized = value.trim().normalize("NFC");
  return normalized === "" ? null : normalized;
}

function normalizeOptionalTextOrNull({ value }: TransformFnParams): unknown {
  return normalizeTextOrNull(value);
}

function normalizeOptionalEmailOrNull({ value }: TransformFnParams): unknown {
  const normalized = normalizeTextOrNull(value);
  return typeof normalized === "string" ? normalized.toLowerCase() : normalized;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: "Иванов", maxLength: 100 })
  @Transform(normalizeRequiredText)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "Фамилия должна быть строкой" })
  @IsNotEmpty({ message: "Укажите фамилию" })
  @Length(1, 100, { message: "Фамилия не должна превышать 100 символов" })
  lastName?: string;

  @ApiPropertyOptional({ example: "Иван", maxLength: 100 })
  @Transform(normalizeRequiredText)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "Имя должно быть строкой" })
  @IsNotEmpty({ message: "Укажите имя" })
  @Length(1, 100, { message: "Имя не должно превышать 100 символов" })
  firstName?: string;

  @ApiPropertyOptional({ example: "Иванович", maxLength: 100, nullable: true })
  @Transform(normalizeOptionalTextOrNull)
  @IsOptional()
  @IsString({ message: "Отчество должно быть строкой" })
  @Length(1, 100, { message: "Отчество не должно превышать 100 символов" })
  patronymic?: string | null;

  @ApiPropertyOptional({
    example: "+7 900 123-45-67",
    maxLength: 32,
    nullable: true,
  })
  @Transform(normalizeOptionalTextOrNull)
  @IsOptional()
  @Matches(/^\+?[0-9][0-9\s()-]{4,30}$/, {
    message: "Введите корректный номер телефона",
  })
  phone?: string | null;

  @ApiPropertyOptional({
    example: "ivanov@example.ru",
    maxLength: 320,
    nullable: true,
  })
  @Transform(normalizeOptionalEmailOrNull)
  @IsOptional()
  @IsEmail({}, { message: "Введите корректный email" })
  @Length(1, 320, { message: "Email не должен превышать 320 символов" })
  email?: string | null;

  @ApiPropertyOptional({ enum: Role, enumName: "Role", nullable: true })
  @IsOptional()
  @IsEnum(Role, { message: "Недопустимая роль пользователя" })
  role?: Role | null;
}
