// src/agent-modules/outbound-campaign-template/outbound-campaign-template.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma, TemplateStatus } from '@prisma/client';

import { PrismaService } from 'src/prisma/prisma.service';

import { CreateOutboundCampaignTemplateDto } from './dto/create-outbound-campaign-template.dto';
import { UpdateOutboundCampaignTemplateDto } from './dto/update-outbound-campaign-template.dto';
import { QueryOutboundCampaignTemplatesDto } from './dto/query-outbound-campaign-templates.dto';
import { IOutboundCampaignTemplate } from './interface/outbound-campaign-template.interface';
import { OutboundCampaignTemplateRepository } from './respository/outbound-campaign-template.repository';

@Injectable()
export class OutboundCampaignTemplateService {
  private readonly logger = new Logger(OutboundCampaignTemplateService.name);

  /**
   * Fixed OutboundLead fields allowed in templates.
   * Keep this small and explicit per your requirement.
   */
  private readonly FIXED_LEAD_FIELDS: string[] = ['phoneNumber', 'firstName', 'timeZone'];

  constructor(
    private readonly repo: OutboundCampaignTemplateRepository,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  async create(
    outboundCampaignId: string,
    dto: CreateOutboundCampaignTemplateDto,
  ): Promise<IOutboundCampaignTemplate> {
    try {
      this.validateName(dto.name);
      this.validateBody(dto.body);

      const { variables, unknown } = await this.computeVariablesForCampaignBody(
        outboundCampaignId,
        dto.body,
      );
      if (unknown.length) {
        const allowed = await this.allowedVariableNames(outboundCampaignId);
        throw new BadRequestException({
          message: 'Unknown variables detected in template body',
          unknown,
          allowed,
        });
      }

      // Force variables to computed set
      return await this.repo.create(outboundCampaignId, {
        ...dto,
        variables,
      });
    } catch (e) {
      this.mapAndThrow(e, 'creating template', { outboundCampaignId, dto });
    }
  }

  // ---------------------------------------------------------------------------
  // Read (list + get one)
  // ---------------------------------------------------------------------------
  async findMany(outboundCampaignId: string, q: QueryOutboundCampaignTemplatesDto) {
    try {
      return await this.repo.findMany(outboundCampaignId, q);
    } catch (e) {
      this.mapAndThrow(e, 'listing templates', { outboundCampaignId, q });
    }
  }

  async findOne(id: string): Promise<IOutboundCampaignTemplate> {
    try {
      const tpl = await this.repo.findById(id);
      if (!tpl) throw new NotFoundException('Template not found');
      return tpl;
    } catch (e) {
      this.mapAndThrow(e, 'reading template', { id });
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  async update(id: string, dto: UpdateOutboundCampaignTemplateDto): Promise<IOutboundCampaignTemplate> {
    const existing = await this.ensureExists(id);

    if (dto.name !== undefined) this.validateName(dto.name);
    if (dto.body !== undefined) this.validateBody(dto.body);

    try {
      let computed: string[] | undefined;

      if (dto.body !== undefined) {
        const { variables, unknown } = await this.computeVariablesForCampaignBody(
          existing.outboundCampaignId,
          dto.body,
        );
        if (unknown.length) {
          const allowed = await this.allowedVariableNames(existing.outboundCampaignId);
          throw new BadRequestException({
            message: 'Unknown variables detected in template body',
            unknown,
            allowed,
          });
        }
        computed = variables;
      }

      return await this.repo.update(id, {
        ...dto,
        ...(computed ? { variables: computed } : {}),
      });
    } catch (e) {
      this.mapAndThrow(e, 'updating template', { id, dto });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async setStatus(id: string, status: TemplateStatus): Promise<IOutboundCampaignTemplate> {
    await this.ensureExists(id);
    try {
      return await this.repo.setStatus(id, status);
    } catch (e) {
      this.mapAndThrow(e, 'setting template status', { id, status });
    }
  }

  async setDefault(id: string, isDefault = true): Promise<IOutboundCampaignTemplate> {
    await this.ensureExists(id);
    try {
      return await this.repo.setDefault(id, isDefault);
    } catch (e) {
      this.mapAndThrow(e, 'setting template default', { id, isDefault });
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  async remove(id: string): Promise<IOutboundCampaignTemplate> {
    await this.ensureExists(id);
    try {
      return await this.repo.remove(id);
    } catch (e) {
      this.mapAndThrow(e, 'deleting template', { id });
    }
  }

  // ---------------------------------------------------------------------------
  // NEW: list intake field names for a campaign
  // ---------------------------------------------------------------------------

  /**
   * Return ONLY the field names defined in leadCustomFieldInatake
   * for a given campaign. This is what the UI can show as available
   * custom variables, separate from the fixed lead fields.
   *
   * @param outboundCampaignId campaign id (UUID)
   * @returns string[] of unique intake names (sorted)
   */
  async listCampaignIntakeFieldNames(outboundCampaignId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.leadCustomFieldInatake.findMany({
        where: { outboundCampaignId },
        select: { name: true },
        orderBy: { createdAt: 'asc' },
      });

      // trim, filter empties, dedupe, sort
      const names = rows
        .map(r => (r.name ?? '').trim())
        .filter(n => n.length > 0);

      return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.mapAndThrow(e, 'listing intake field names', { outboundCampaignId });
    }
  }

  // ---------------------------------------------------------------------------
  // Variable computation (AUTO)
  // ---------------------------------------------------------------------------

  /**
   * Parse placeholders from body and validate against allowed variables
   * for the given campaign:
   *  - Fixed OutboundLead fields (FIXED_LEAD_FIELDS)
   *  - Names from leadCustomFieldInatake for this campaign
   */
  private async computeVariablesForCampaignBody(
    outboundCampaignId: string,
    body: string,
  ): Promise<{ variables: string[]; unknown: string[] }> {
    const placeholders = this.extractPlaceholders(body);
    if (placeholders.length === 0) return { variables: [], unknown: [] };

    const allowed = new Set(await this.allowedVariableNames(outboundCampaignId));

    const variables: string[] = [];
    const unknown: string[] = [];

    for (const v of placeholders) {
      if (allowed.has(v)) variables.push(v);
      else unknown.push(v);
    }

    return {
      variables: Array.from(new Set(variables)),
      unknown: Array.from(new Set(unknown)),
    };
  }

  /**
   * Allowed variable names:
   *  - Fixed lead fields (phoneNumber, firstName, timeZone)
   *  - All intake names for this campaign from leadCustomFieldInatake
   */
  private async allowedVariableNames(outboundCampaignId: string): Promise<string[]> {
    const intakes = await this.prisma.leadCustomFieldInatake.findMany({
      where: { outboundCampaignId },
      select: { name: true },
    });
    const intakeNames = intakes.map((i) => i.name).filter(Boolean);

    return Array.from(new Set([...this.FIXED_LEAD_FIELDS, ...intakeNames]));
  }

  /**
   * Extract `{{ variable }}` placeholders from the template body.
   */
  private extractPlaceholders(body: string): string[] {
    const re = /{{\s*([A-Za-z0-9_]+)\s*}}/g; // simple keys only as requested
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out.push(m[1]);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async ensureExists(id: string): Promise<IOutboundCampaignTemplate> {
    try {
      const tpl = await this.repo.findById(id);
      if (!tpl) throw new NotFoundException('Template not found');
      return tpl;
    } catch (e) {
      this.mapAndThrow(e, 'checking template existence', { id });
    }
  }

  private validateName(name: string) {
    const n = (name ?? '').trim();
    if (!n) throw new BadRequestException('Name is required');
    if (n.length > 120) throw new BadRequestException('Name max length is 120 characters');
  }

  private validateBody(body: string) {
    const b = (body ?? '').trim();
    if (!b) throw new BadRequestException('Body is required');
    if (b.length > 5000) throw new BadRequestException('Body max length is 5000 characters');
  }

  private mapAndThrow(error: any, when: string, meta?: Record<string, unknown>): never {
    this.logger.error(`[${when}] ${error?.message ?? error}`, meta ?? {});
    if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A template with this name already exists in the campaign');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Template not found');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Invalid campaign reference');
      }
    }
    throw new InternalServerErrorException('Unexpected error while processing template');
  }
}
