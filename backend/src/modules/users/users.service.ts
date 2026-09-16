import { Injectable } from "@nestjs/common";

import type { Role } from "../../generated/prisma/enums.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

const publicUserSelection = {
  id: true,
  login: true,
  role: true,
  createdAt: true,
} as const;

export interface PublicUser {
  id: string;
  login: string;
  role: Role | null;
  createdAt: Date;
}

export interface UserCredentials extends PublicUser {
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelection,
    });
  }

  findCredentialsByLogin(login: string): Promise<UserCredentials | null> {
    return this.prisma.user.findUnique({
      where: { login },
      select: {
        ...publicUserSelection,
        passwordHash: true,
      },
    });
  }

  create(login: string, passwordHash: string): Promise<PublicUser> {
    return this.prisma.user.create({
      data: { login, passwordHash },
      select: publicUserSelection,
    });
  }
}
