import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UserService } from '../services/user.service';
import {
  CreateUserDto,
  createUserSchema,
  UpdateUserDto,
  updateUserSchema,
} from '../schemas/user.schema';
import { ZodValidationPipe } from '../../common/pipes/zod.validation.pipe';

@Controller('users')
export class UserController {
  // 1. The UserService is injected here via the constructor.
  constructor(private readonly userService: UserService) {}


  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema))
    createUserDto: CreateUserDto,
  ) {
    return this.userService.createUser(createUserDto);
  }

 
}