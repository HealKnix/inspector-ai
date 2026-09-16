import { ApiProperty } from "@nestjs/swagger";

import { Role } from "../../../generated/prisma/enums.js";
import type { PublicUser } from "../../users/users.service.js";

export class UserDto implements PublicUser {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "inspector.ivanov" })
  login!: string;

  @ApiProperty({
    enum: Role,
    enumName: "Role",
    example: Role.INSPECTOR,
    nullable: true,
  })
  role!: Role | null;

  @ApiProperty({ format: "date-time", type: String })
  createdAt!: Date;
}

export class UserResponseDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;
}

export class AuthResponseDto extends UserResponseDto {
  @ApiProperty({ description: "Короткоживущий JWT для Authorization: Bearer" })
  accessToken!: string;
}
