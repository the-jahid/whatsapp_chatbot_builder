// ===================================================
// 4. Service: src/agent/agent.service.ts
// ===================================================
import { Injectable, NotFoundException } from '@nestjs/common';
import { Agent, Prisma, MemoryType } from '@prisma/client'; // Import MemoryType
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import { PrismaService } from 'src/prisma/prisma.service';

export interface PaginatedAgentsResult {
  data: Agent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// UPDATED: Sortable fields now include memoryType
type AgentSortableFields =
  | 'id'
  | 'name'
  | 'prompt'
  | 'apiKey'
  | 'isActive'
  | 'memoryType' // <-- Updated
  | 'isLeadsActive'
  | 'isEmailActive'
  | 'createdAt'
  | 'updatedAt';

// UPDATED: Query interface now includes memoryType
export interface GetAllAgentsQuery {
  page?: string;
  limit?: string;
  sortBy?: AgentSortableFields;
  sortOrder?: 'asc' | 'desc';
  id?: string;
  isActive?: string;
  memoryType?: MemoryType; // <-- Updated
  isLeadsActive?: string;
  isEmailActive?: string;
  name?: string;
  prompt?: string;
  apiKey?: string;
}

@Injectable()
export class AgentService {
  constructor(private prisma: PrismaService) {}

  async getAll(userId: string, query: GetAllAgentsQuery): Promise<PaginatedAgentsResult> {
    const { page = '1', limit = '10', sortBy = 'createdAt', sortOrder = 'desc', ...filters } = query;
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    const skip = (pageNumber - 1) * limitNumber;

    const where: Prisma.AgentWhereInput = { userId };

    // UPDATED: Filtering logic now handles memoryType
    for (const key in filters) {
      if (Object.prototype.hasOwnProperty.call(filters, key)) {
        const value = filters[key];
        if (['isActive', 'isLeadsActive', 'isEmailActive'].includes(key)) {
          where[key] = String(value).toLowerCase() === 'true';
        } else if (key === 'memoryType' && value) {
          where[key] = value as MemoryType; // Filter by the memory type enum
        } else if (value && typeof value === 'string') {
          where[key] = { contains: value, mode: 'insensitive' };
        }
      }
    }
    
    const orderBy: Prisma.AgentOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [agents, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({ where, skip, take: limitNumber, orderBy }),
      this.prisma.agent.count({ where }),
    ]);

    return {
      data: agents,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async getById(id: string, userId?: string): Promise<Agent> {
    const where: Prisma.AgentWhereInput = { id };
    if (userId) {
      where.userId = userId;
    }
    const agent = await this.prisma.agent.findFirst({ where });

    if (!agent) {
      throw new NotFoundException(`Agent with ID "${id}" not found.`);
    }
    return agent;
  }

  async create(createAgentDto: CreateAgentDto): Promise<Agent> {
    const { userId } = createAgentDto;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found. Cannot create agent.`);
    }
    return this.prisma.agent.create({ data: createAgentDto as any });
  }

  async update(id: string, updateAgentDto: UpdateAgentDto, userId?: string): Promise<Agent> {
    await this.getById(id, userId); // Verifies ownership
    return this.prisma.agent.update({
      where: { id },
      data: updateAgentDto as any,
    });
  }

  async delete(id: string, userId?: string): Promise<Agent> {
    await this.getById(id, userId); // Verifies ownership
    return this.prisma.agent.delete({
      where: { id },
    });
  }
}