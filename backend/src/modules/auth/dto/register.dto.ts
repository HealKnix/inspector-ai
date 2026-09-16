import { ApiProperty } from "@nestjs/swagger";
import { Transform, type TransformFnParams } from "class-transformer";
import { IsString, Length, Matches } from "class-validator";

function normalizeLogin({ value }: TransformFnParams): unknown {
  return typeof value === "string"
    ? value.trim().normalize("NFC").toLowerCase()
    : value;
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
}
