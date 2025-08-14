import { Injectable, NotFoundException } from '@nestjs/common';

import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from '../schemas/user.schema';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async createUser(data: CreateUserDto): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async updateUser(oauthId: string, data: UpdateUserDto): Promise<User> {
    const user = await this.findUserByOauthId(oauthId);
    return this.prisma.user.update({
      where: { id: user.id },
      data,
    });
  }

  async deleteUser(oauthId: string): Promise<User> {
    const user = await this.findUserByOauthId(oauthId);
    return this.prisma.user.delete({
      where: { id: user.id },
    });
  }

  // A helper to find users by their Clerk ID
  private async findUserByOauthId(oauthId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { oauthId } });
    if (!user) {
      throw new NotFoundException(`User with OAuth ID "${oauthId}" not found.`);
    }
    return user;
  }
}