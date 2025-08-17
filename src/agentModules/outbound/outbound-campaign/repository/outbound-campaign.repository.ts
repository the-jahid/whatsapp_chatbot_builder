// src/agent-modules/outbound-campaign/repository/outbound-campaign.repository.ts
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  OutboundCampaignStatus,
  OutboundCampaignType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import { IOutboundCampaign } from '../interface/outbound-campaign.interface';
import {
  IOutboundCampaignQuery,
  OutboundCampaignSortBy,
} from '../interface/outbound-campaign-query.interface';

import { CreateOutboundCampaignDto } from '../dto/create-outbound-campaign.dto';
import { UpdateOutboundCampaignDto } from '../dto/update-outbound-campaign.dto';
import { ScheduleOutboundCampaignDto } from '../dto/schedule-outbound-campaign.dto';
import { ToggleAgentDto } from '../dto/toggle-agent.dto';
import { SetStatusDto } from '../dto/set-status.dto';
import { RecordActivityDto } from '../dto/record-activity.dto';

type OutboundCampaignSelect = Prisma.OutboundCampaignSelect;
type OutboundCampaignWhereInput = Prisma.OutboundCampaignWhereInput;
type OutboundCampaignOrderByInput =
  Prisma.OutboundCampaignOrderByWithRelationInput;

@Injectable()
export class OutboundCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Create / Read / Update / Delete
  // ------------------------------------------------------------------

  /**
   * Create a campaign for a specific agent.
   * NOTE: agentId is provided separately (path param), NOT in the DTO body.
   */
  async create(
    agentId: string,
    dto: CreateOutboundCampaignDto,
  ): Promise<IOutboundCampaign> {
    return this.prisma.outboundCampaign.create({
      data: {
        agentId,
        name: dto.name,
        type: dto.type ?? OutboundCampaignType.SINGLE,
        status: dto.status ?? OutboundCampaignStatus.DRAFT,
        agentEnabled: dto.agentEnabled ?? true,
        scheduledAt: dto.scheduledAt ?? null,
        config: dto.config ?? undefined,
        stats: dto.stats ?? undefined,
      },
    });
  }

  /**
   * Find one by ID. If you pass a `select`, you'll get that typed payload back;
   * otherwise it returns the full IOutboundCampaign shape.
   */
  async findById<T extends OutboundCampaignSelect | undefined = undefined>(
    id: string,
    select?: T,
  ): Promise<
    | (T extends undefined
        ? IOutboundCampaign
        : Prisma.OutboundCampaignGetPayload<{ select: T }>)
    | null
  > {
    return (this.prisma.outboundCampaign.findUnique({
      where: { id },
   
      select,
    }) as unknown) as Promise<
      | (T extends undefined
          ? IOutboundCampaign
          : Prisma.OutboundCampaignGetPayload<{ select: T }>)
      | null
    >;
  }

  /**
   * Update supports clearing scheduledAt by sending null.
   * Only set scheduledAt if the key is present on the DTO.
   */
  async update(
    id: string,
    dto: UpdateOutboundCampaignDto,
  ): Promise<IOutboundCampaign> {
    const data: Prisma.OutboundCampaignUpdateInput = {
      name: dto.name,
      type: dto.type,
      status: dto.status,
      agentEnabled: dto.agentEnabled,
      config: dto.config,
      stats: dto.stats,
    };

    if ('scheduledAt' in dto) {
      // can be Date or null to clear
      (data as Prisma.OutboundCampaignUncheckedUpdateInput).scheduledAt =
        dto.scheduledAt as any;
    }

    return this.prisma.outboundCampaign.update({
      where: { id },
      data,
    });
  }

  async remove(id: string): Promise<IOutboundCampaign> {
    return this.prisma.outboundCampaign.delete({ where: { id } });
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async schedule(
    id: string,
    dto: ScheduleOutboundCampaignDto,
  ): Promise<IOutboundCampaign> {
    return this.prisma.outboundCampaign.update({
      where: { id },
      data: { scheduledAt: dto.scheduledAt },
    });
  }

  async setStatus(id: string, dto: SetStatusDto): Promise<IOutboundCampaign> {
    return this.prisma.outboundCampaign.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async toggleAgent(
    id: string,
    enabled: ToggleAgentDto['agentEnabled'],
  ): Promise<IOutboundCampaign> {
    return this.prisma.outboundCampaign.update({
      where: { id },
      data: { agentEnabled: enabled },
    });
  }

  /**
   * Atomically increment counters and bump lastActivityAt (or use provided value).
   */
  async recordActivity(
    id: string,
    dto: RecordActivityDto,
  ): Promise<IOutboundCampaign> {
    const data: Prisma.OutboundCampaignUpdateInput = {
      lastActivityAt: dto.lastActivityAt ?? new Date(),
    };

    if (dto.totalMessagesIncrement !== undefined) {
      (data as any).totalMessages = { increment: dto.totalMessagesIncrement };
    }
    if (dto.leadsCountIncrement !== undefined) {
      (data as any).leadsCount = { increment: dto.leadsCountIncrement };
    }
    if (dto.answeredLeadsCountIncrement !== undefined) {
      (data as any).answeredLeadsCount = {
        increment: dto.answeredLeadsCountIncrement,
      };
    }

    return this.prisma.outboundCampaign.update({ where: { id }, data });
  }

  // ------------------------------------------------------------------
  // Query / List
  // ------------------------------------------------------------------

  async findMany(query: IOutboundCampaignQuery): Promise<{
    data: IOutboundCampaign[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [total, data] = await this.prisma.$transaction([
      this.prisma.outboundCampaign.count({ where }),
      this.prisma.outboundCampaign.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private buildWhere(
    query: IOutboundCampaignQuery,
  ): OutboundCampaignWhereInput {
    const where: OutboundCampaignWhereInput = {};

    if (query.agentId) {
      where.agentId = query.agentId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = Array.isArray(query.status)
        ? { in: query.status }
        : query.status;
    }

    if (query.q && query.q.trim().length) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }

    // date ranges
    if (query.scheduledFrom || query.scheduledTo) {
      where.scheduledAt = {};
      if (query.scheduledFrom)
        (where.scheduledAt as Prisma.DateTimeFilter).gte = new Date(
          query.scheduledFrom,
        );
      if (query.scheduledTo)
        (where.scheduledAt as Prisma.DateTimeFilter).lte = new Date(
          query.scheduledTo,
        );
    }

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom)
        (where.createdAt as Prisma.DateTimeFilter).gte = new Date(
          query.createdFrom,
        );
      if (query.createdTo)
        (where.createdAt as Prisma.DateTimeFilter).lte = new Date(
          query.createdTo,
        );
    }

    return where;
    }

  private buildOrderBy(
    sortBy?: OutboundCampaignSortBy,
    sortOrder?: 'asc' | 'desc',
  ): OutboundCampaignOrderByInput {
    const by: OutboundCampaignSortBy = sortBy ?? 'createdAt';
    const order: 'asc' | 'desc' = sortOrder ?? 'desc';

    switch (by) {
      case 'scheduledAt':
        return { scheduledAt: order };
      case 'lastActivityAt':
        return { lastActivityAt: order };
      case 'name':
        return { name: order };
      case 'status':
        return { status: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }
}
