import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, type TransformFnParams } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

function normalizeLogin({ value }: TransformFnParams): unknown {
  return typeof value === "string"
    ? value.trim().normalize("NFC").toLowerCase()
    : value;
}

function normalizeRequiredText({ value }: TransformFnParams): unknown {
  return typeof value === "string" ? value.trim().normalize("NFC") : value;
}

function normalizeTextValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const normalized = value.trim().normalize("NFC");
  return normalized === "" ? undefined : normalized;
}

function normalizeOptionalText({ value }: TransformFnParams): unknown {
  return normalizeTextValue(value);
}

function normalizeOptionalEmail({ value }: TransformFnParams): unknown {
  const normalized = normalizeTextValue(value);
  return typeof normalized === "string" ? normalized.toLowerCase() : normalized;
}

export class RegisterDto {
  @ApiProperty({ example: "inspector.ivanov", minLength: 3, maxLength: 64 })
  @Transform(normalizeLogin)
  @IsString({ message: "Логин должен быть строкой" })
  @Length(3, 64, { message: "Логин должен содержать от 3 до 64 символов" })
  @Matches(/^[^\s\p{Cc}\p{Cf}]+$/u, {
    message: "Логин не должен содержать пробелы и управляющие символы",
  })
  login!: string;

  @ApiProperty({ format: "password", minLength: 12, maxLength: 128 })
  @IsString({ message: "Пароль должен быть строкой" })
  @Length(12, 128, { message: "Пароль должен содержать от 12 до 128 символов" })
  password!: string;

  @ApiProperty({ example: "Иванов", maxLength: 100 })
  @Transform(normalizeRequiredText)
  @IsString({ message: "Фамилия должна быть строкой" })
  @IsNotEmpty({ message: "Укажите фамилию" })
  @Length(1, 100, { message: "Фамилия не должна превышать 100 символов" })
  lastName!: string;

  @ApiProperty({ example: "Иван", maxLength: 100 })
  @Transform(normalizeRequiredText)
  @IsString({ message: "Имя должно быть строкой" })
  @IsNotEmpty({ message: "Укажите имя" })
  @Length(1, 100, { message: "Имя не должно превышать 100 символов" })
  firstName!: string;

  @ApiPropertyOptional({ example: "Иванович", maxLength: 100 })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString({ message: "Отчество должно быть строкой" })
  @Length(1, 100, { message: "Отчество не должно превышать 100 символов" })
  patronymic?: string;

  @ApiPropertyOptional({ example: "+7 900 123-45-67", maxLength: 32 })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @Matches(/^\+?[0-9][0-9\s()-]{4,30}$/, {
    message: "Введите корректный номер телефона",
  })
  phone?: string;

  @ApiPropertyOptional({ example: "ivanov@example.ru", maxLength: 320 })
  @Transform(normalizeOptionalEmail)
  @IsOptional()
  @IsEmail({}, { message: "Введите корректный email" })
  @Length(1, 320, { message: "Email не должен превышать 320 символов" })
  email?: string;
}
