// src/lead-item/lead-item.service.ts

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

import { LeadItem, Prisma } from '@prisma/client';
import { CreateLeadItemDto, UpdateLeadItemDto } from './dto/lead-item.dto';

/**
 * Interface for the paginated result of fetching lead items.
 */
export interface PaginatedLeadItemsResult {
  data: LeadItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Defines the fields that can be used for sorting lead items.
 */
type LeadItemSortableFields = 'name' | 'description' | 'createdAt' | 'updatedAt';

/**
 * Interface for the query parameters used when fetching lead items.
 */
export interface GetAllLeadItemsQuery {
  page?: string;
  limit?: string;
  sortBy?: LeadItemSortableFields;
  sortOrder?: 'asc' | 'desc';
  name?: string;
  description?: string;
}

@Injectable()
export class LeadItemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new lead item for a specific agent.
   * Ensures the agent exists and the lead item name is unique for that agent.
   */
  async create(createLeadItemDto: CreateLeadItemDto) {
    const { agentId, name } = createLeadItemDto;

    // Verify that the agent exists
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new NotFoundException(`Agent with ID "${agentId}" not found.`);
    }

    try {
      return await this.prisma.leadItem.create({
        data: createLeadItemDto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // This error code indicates a unique constraint violation on (agentId, name)
        throw new ConflictException(`A lead item with the name "${name}" already exists for this agent.`);
      }
      throw error;
    }
  }

  /**
   * Finds all lead items belonging to a specific agent, with filtering and pagination.
   */
  async findAllForAgent(
    agentId: string,
    query: GetAllLeadItemsQuery,
  ): Promise<PaginatedLeadItemsResult> {
    const { page = '1', limit = '10', sortBy = 'createdAt', sortOrder = 'desc', ...filters } = query;
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    const skip = (pageNumber - 1) * limitNumber;

    const where: Prisma.LeadItemWhereInput = { agentId };

    // Dynamically build the where clause for filtering
    for (const key in filters) {
      if (Object.prototype.hasOwnProperty.call(filters, key)) {
        const value = filters[key];
        if (value) {
          // Use case-insensitive 'contains' for string searches
          where[key] = { contains: value, mode: 'insensitive' };
        }
      }
    }

    const orderBy: Prisma.LeadItemOrderByWithRelationInput = { [sortBy]: sortOrder };

    // Use a transaction to get both data and total count efficiently
    const [leadItems, total] = await this.prisma.$transaction([
      this.prisma.leadItem.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy,
      }),
      this.prisma.leadItem.count({ where }),
    ]);

    return {
      data: leadItems,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  /**
   * Finds a single lead item by its ID.
   */
  async findOne(id: string) {
    const leadItem = await this.prisma.leadItem.findUnique({ where: { id } });
    if (!leadItem) {
      throw new NotFoundException(`Lead Item with ID "${id}" not found.`);
    }
    return leadItem;
  }

  /**
   * Updates a lead item.
   */
  async update(id: string, updateLeadItemDto: UpdateLeadItemDto) {
    // First, ensure the lead item exists
    await this.findOne(id);
    return this.prisma.leadItem.update({
      where: { id },
      data: updateLeadItemDto,
    });
  }

  /**
   * Deletes a lead item.
   */
  async remove(id: string) {
    // First, ensure the lead item exists
    await this.findOne(id);
    return this.prisma.leadItem.delete({ where: { id } });
  }
}




