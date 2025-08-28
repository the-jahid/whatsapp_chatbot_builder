import { Injectable } from '@nestjs/common';
import { Prisma, TemplateStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import { IOutboundCampaignTemplate } from '../interface/outbound-campaign-template.interface';
import { CreateOutboundCampaignTemplateDto } from '../dto/create-outbound-campaign-template.dto';
import { UpdateOutboundCampaignTemplateDto } from '../dto/update-outbound-campaign-template.dto';
import { QueryOutboundCampaignTemplatesDto } from '../dto/query-outbound-campaign-templates.dto';

@Injectable()
export class OutboundCampaignTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------
  // Create
  // ------------------------------------------------------------
  async create(
    outboundCampaignId: string,
    dto: CreateOutboundCampaignTemplateDto,
  ): Promise<IOutboundCampaignTemplate> {
    return this.prisma.$transaction(async (tx) => {
      // If this template should be default, unset existing default in campaign
      if (dto.isDefault) {
        await tx.outboundCampaignTemplate.updateMany({
          where: { outboundCampaignId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.outboundCampaignTemplate.create({
        data: {
          outboundCampaignId,
          name: dto.name,
          body: dto.body,
          variables: dto.variables ?? [],
          locale: dto.locale,
          status: dto.status ?? TemplateStatus.DRAFT,
          isDefault: dto.isDefault ?? false,
        },
      });

      return created as unknown as IOutboundCampaignTemplate;
    });
  }

  // ------------------------------------------------------------
  // Read
  // ------------------------------------------------------------
  async findById(id: string): Promise<IOutboundCampaignTemplate | null> {
    const tpl = await this.prisma.outboundCampaignTemplate.findUnique({
      where: { id },
    });
    return tpl as unknown as IOutboundCampaignTemplate | null;
  }

  async findMany(
    outboundCampaignId: string,
    q: QueryOutboundCampaignTemplatesDto,
  ): Promise<{ total: number; data: IOutboundCampaignTemplate[]; skip: number; take: number }> {
    const {
      take = 20,
      skip = 0,
      search,
      status,
      isDefault,
      orderBy = 'createdAt',
      order = 'desc',
    } = q as any;

    const where: Prisma.OutboundCampaignTemplateWhereInput = {
      outboundCampaignId,
      ...(typeof isDefault === 'boolean' ? { isDefault } : {}),
      ...(status?.length ? { status: { in: status } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { body: { contains: search, mode: 'insensitive' } },
              { locale: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.outboundCampaignTemplate.count({ where }),
      this.prisma.outboundCampaignTemplate.findMany({
        where,
        orderBy: { [orderBy]: order },
        skip,
        take,
      }),
    ]);

    return {
      total,
      data: rows as unknown as IOutboundCampaignTemplate[],
      skip,
      take,
    };
  }

  // ------------------------------------------------------------
  // Update
  // ------------------------------------------------------------
  async update(id: string, dto: UpdateOutboundCampaignTemplateDto): Promise<IOutboundCampaignTemplate> {
    return this.prisma.$transaction(async (tx) => {
      // If turning this template into default, unset existing default in campaign
      if (dto.isDefault === true) {
        const current = await tx.outboundCampaignTemplate.findUnique({
          where: { id },
          select: { outboundCampaignId: true },
        });
        if (current) {
          await tx.outboundCampaignTemplate.updateMany({
            where: {
              outboundCampaignId: current.outboundCampaignId,
              isDefault: true,
              NOT: { id },
            },
            data: { isDefault: false },
          });
        }
      }

      const updated = await tx.outboundCampaignTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(dto.variables !== undefined ? { variables: dto.variables } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });

      return updated as unknown as IOutboundCampaignTemplate;
    });
  }

  async setStatus(id: string, status: TemplateStatus): Promise<IOutboundCampaignTemplate> {
    const updated = await this.prisma.outboundCampaignTemplate.update({
      where: { id },
      data: { status },
    });
    return updated as unknown as IOutboundCampaignTemplate;
  }

  async setDefault(id: string, isDefault = true): Promise<IOutboundCampaignTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const tpl = await tx.outboundCampaignTemplate.findUnique({
        where: { id },
        select: { id: true, outboundCampaignId: true },
      });
      if (!tpl) return null as unknown as IOutboundCampaignTemplate;

      if (isDefault) {
        await tx.outboundCampaignTemplate.updateMany({
          where: { outboundCampaignId: tpl.outboundCampaignId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.outboundCampaignTemplate.update({
        where: { id },
        data: { isDefault },
      });

      return updated as unknown as IOutboundCampaignTemplate;
    });
  }

  // ------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------
  async remove(id: string): Promise<IOutboundCampaignTemplate> {
    const deleted = await this.prisma.outboundCampaignTemplate.delete({
      where: { id },
    });
    return deleted as unknown as IOutboundCampaignTemplate;
  }
}
