import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, ValidateIf } from "class-validator";

import { Role } from "../../../generated/prisma/enums.js";
import { RegisterDto } from "../../auth/dto/register.dto.js";

export class CreateUserDto extends RegisterDto {
  @ApiPropertyOptional({ enum: Role, enumName: "Role", example: "INSPECTOR" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(Role, { message: "Недопустимая роль пользователя" })
  role?: Role;
}
