import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";

import { Roles } from "../../common/decorators/roles.decorator.js";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { PasswordService } from "../auth/password.service.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UsersService } from "./users.service.js";

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

@ApiTags("admin-users")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@Roles("ADMINISTRATOR")
@Controller("v1/admin/users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
  ) {}

  @Get()
  list() {
    return this.usersService.list();
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const existingUser = await this.usersService.findCredentialsByLogin(
      dto.login,
    );

    if (existingUser) {
      throw new ConflictException(
        "Пользователь с таким логином уже зарегистрирован",
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      return await this.usersService.create({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        login: dto.login,
        passwordHash,
        patronymic: dto.patronymic,
        phone: dto.phone,
        role: dto.role,
      });
    } catch (error: unknown) {
      if (isPrismaError(error, "P2002")) {
        throw new ConflictException(
          "Пользователь с таким логином уже зарегистрирован",
        );
      }

      throw error;
    }
  }

  @Patch(":id")
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    if (
      id === request.user.id &&
      dto.role !== undefined &&
      dto.role !== request.user.role
    ) {
      throw new BadRequestException(
        "Нельзя изменить собственную роль — попросите другого администратора",
      );
    }

    try {
      return await this.usersService.update(id, dto);
    } catch (error: unknown) {
      if (isPrismaError(error, "P2025")) {
        throw new NotFoundException("Пользователь не найден");
      }

      throw error;
    }
  }
}
