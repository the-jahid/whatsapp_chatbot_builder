// src/agent-modules/outbound-campaign/outbound-campaign.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import {
  Prisma,
  OutboundCampaignStatus,
  OutboundCampaignType,
  OutboundLeadStatus,
} from '@prisma/client';

import { OutboundCampaignRepository } from './repository/outbound-campaign.repository';
import { CreateOutboundCampaignDto } from './dto/create-outbound-campaign.dto';
import { UpdateOutboundCampaignDto } from './dto/update-outbound-campaign.dto';
import { ScheduleOutboundCampaignDto } from './dto/schedule-outbound-campaign.dto';
import { ToggleAgentDto } from './dto/toggle-agent.dto';
import { QueryOutboundCampaignsDto } from './dto/query-outbound-campaigns.dto';
import { RecordActivityDto } from './dto/record-activity.dto';

import { IOutboundCampaign } from './interface/outbound-campaign.interface';
import { IOutboundCampaignStats } from './interface/outbound-campaign-stats.interface';

// 🔁 deps for recipients & WhatsApp sending
import { OutboundLeadRepository } from '../outbound-lead/repository/outbound-lead.repository';
import { WhatsappService } from 'src/agentModules/whatsapp/whatsapp.service';


// Allowed status transitions
const ALLOWED: Record<OutboundCampaignStatus, OutboundCampaignStatus[]> = {
  [OutboundCampaignStatus.DRAFT]: [
    OutboundCampaignStatus.SCHEDULED,
    OutboundCampaignStatus.RUNNING,
    OutboundCampaignStatus.CANCELLED,
  ],
  [OutboundCampaignStatus.SCHEDULED]: [
    OutboundCampaignStatus.RUNNING,
    OutboundCampaignStatus.CANCELLED,
  ],
  [OutboundCampaignStatus.RUNNING]: [
    OutboundCampaignStatus.COMPLETED,
    OutboundCampaignStatus.CANCELLED,
  ],
  [OutboundCampaignStatus.COMPLETED]: [],
  [OutboundCampaignStatus.CANCELLED]: [],
};

// Terminal helper
const TERMINAL = new Set<OutboundCampaignStatus>([
  OutboundCampaignStatus.COMPLETED,
  OutboundCampaignStatus.CANCELLED,
]);

// 🔧 Shim so code works whether your enum has MESSAGE_SUCCESSFUL or CALL_SUCCESSFUL
const LEAD_SUCCESS_STATUS: OutboundLeadStatus =
  (OutboundLeadStatus as any)['MESSAGE_SUCCESSFUL'] ??
  (OutboundLeadStatus as any)['CALL_SUCCESSFUL'];

@Injectable()
export class OutboundCampaignService {
  private readonly logger = new Logger(OutboundCampaignService.name);

  constructor(
    private readonly repo: OutboundCampaignRepository,
    private readonly leadRepo: OutboundLeadRepository,
    private readonly whatsapp: WhatsappService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(agentId: string, dto: CreateOutboundCampaignDto): Promise<IOutboundCampaign> {
    try {
      this.validateName(dto.name);
      if (dto.scheduledAt) this.ensureFuture(dto.scheduledAt, 'scheduledAt');
      return await this.repo.create(agentId, dto);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        this.logger.warn(`[creating campaign] FK failed for agentId=${agentId}`);
        throw new NotFoundException('Agent not found');
      }
      this.mapAndThrow(e, 'creating campaign', { agentId, dto });
    }
  }

  async findMany(q: QueryOutboundCampaignsDto) {
    try {
      return await this.repo.findMany(q);
    } catch (e) {
      this.mapAndThrow(e, 'listing campaigns', { q });
    }
  }

  async findOne(id: string): Promise<IOutboundCampaign> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Campaign not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'reading campaign', { id });
    }
  }

  async update(id: string, dto: UpdateOutboundCampaignDto): Promise<IOutboundCampaign> {
    const current = await this.ensureExists(id);

    if (TERMINAL.has(current.status)) {
      if (
        dto.type !== undefined ||
        dto.status !== undefined ||
        dto.scheduledAt !== undefined ||
        dto.agentEnabled !== undefined
      ) {
        throw new BadRequestException(`Cannot modify a ${current.status.toLowerCase()} campaign`);
      }
    }

    if (dto.name !== undefined) this.validateName(dto.name);
    if (dto.scheduledAt) this.ensureFuture(dto.scheduledAt, 'scheduledAt');
    if (dto.type && !Object.values(OutboundCampaignType).includes(dto.type)) {
      throw new BadRequestException('Invalid campaign type');
    }
    if (dto.status) this.assertTransition(current.status, dto.status);

    try {
      return await this.repo.update(id, dto);
    } catch (e) {
      this.mapAndThrow(e, 'updating campaign', { id, dto, currentStatus: current.status });
    }
  }

  async remove(id: string): Promise<IOutboundCampaign> {
    await this.ensureExists(id);
    try {
      return await this.repo.remove(id);
    } catch (e) {
      this.mapAndThrow(e, 'deleting campaign', { id });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions (existing)
  // ---------------------------------------------------------------------------

  async schedule(id: string, dto: ScheduleOutboundCampaignDto): Promise<IOutboundCampaign> {
    const current = await this.ensureExists(id);

    if (TERMINAL.has(current.status)) {
      throw new BadRequestException(`Cannot schedule a ${current.status.toLowerCase()} campaign`);
    }
    this.ensureFuture(dto.scheduledAt, 'scheduledAt');

    try {
      const updated = await this.repo.schedule(id, dto);
      if (current.status === OutboundCampaignStatus.DRAFT) {
        return await this.repo.setStatus(id, { status: OutboundCampaignStatus.SCHEDULED });
      }
      return updated;
    } catch (e) {
      this.mapAndThrow(e, 'scheduling campaign', { id, dto, currentStatus: current.status });
    }
  }

  async toggleAgent(id: string, enabled: ToggleAgentDto['agentEnabled']): Promise<IOutboundCampaign> {
    await this.ensureExists(id);
    try {
      return await this.repo.toggleAgent(id, enabled);
    } catch (e) {
      this.mapAndThrow(e, 'toggling agent flag', { id, enabled });
    }
  }

  async setStatus(id: string, status: OutboundCampaignStatus): Promise<IOutboundCampaign> {
    const current = await this.ensureExists(id);
    this.assertTransition(current.status, status);
    try {
      return await this.repo.setStatus(id, { status });
    } catch (e) {
      this.mapAndThrow(e, 'setting status', { id, from: current.status, to: status });
    }
  }

  async recordActivity(id: string, dto: RecordActivityDto): Promise<IOutboundCampaign> {
    const current = await this.ensureExists(id);

    if (TERMINAL.has(current.status)) {
      throw new BadRequestException(`Cannot record activity on a ${current.status.toLowerCase()} campaign`);
    }

    try {
      const updated = await this.repo.recordActivity(id, dto);

      const hasActivity =
        (dto.totalMessagesIncrement ?? 0) > 0 ||
        (dto.leadsCountIncrement ?? 0) > 0 ||
        (dto.answeredLeadsCountIncrement ?? 0) > 0;

      if (hasActivity && current.status === OutboundCampaignStatus.SCHEDULED) {
        return await this.repo.setStatus(id, { status: OutboundCampaignStatus.RUNNING });
      }
      return updated;
    } catch (e) {
      this.mapAndThrow(e, 'recording activity', { id, dto, currentStatus: current.status });
    }
  }

  // ---------------------------------------------------------------------------
  // NEW: WhatsApp Outbound Messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a WhatsApp message to a single lead in this campaign.
   */
  async sendToLead(params: {
    agentId: string;
    campaignId: string;
    leadId: string;
    text: string;
  }): Promise<{ messageId: string; to: string; status: 'SENT' | 'FAILED' }> {
    const { agentId, campaignId, leadId, text } = params;

    const campaign = await this.ensureCampaignForAgent(campaignId, agentId);
    this.ensureSendable(campaign);
    await this.ensureWhatsAppReady(agentId);

    // Load lead and verify it belongs to the campaign
    const lead = await this.leadRepo.findById(leadId);
    if (!lead || lead.outboundCampaignId !== campaignId) {
      throw new NotFoundException('Lead not found in this campaign');
    }

    const to = this.toJid(lead.phoneNumber);
    try {
      // Your WhatsappService must expose sendText(agentId, jid, text)
      const res: any = await (this.whatsapp as any).sendText(agentId, to, text);
      if (LEAD_SUCCESS_STATUS) {
        await this.leadRepo.setStatus(leadId, LEAD_SUCCESS_STATUS);
      }
      await this.repo.recordActivity(campaignId, {
        totalMessagesIncrement: 1,
        lastActivityAt: new Date(),
      });
      if (campaign.status === OutboundCampaignStatus.SCHEDULED) {
        await this.repo.setStatus(campaignId, { status: OutboundCampaignStatus.RUNNING });
      }
      return { messageId: res?.id ?? '', to, status: 'SENT' };
    } catch (err) {
      this.logger.error(`[sendToLead] send failed`, { err });
      await this.leadRepo.setStatus(leadId, OutboundLeadStatus.NEED_RETRY);
      return { messageId: '', to, status: 'FAILED' };
    }
  }

  /**
   * Broadcast a WhatsApp message to many leads within a campaign.
   * Defaults to QUEUED + NEED_RETRY.
   */
  async broadcast(params: {
    agentId: string;
    campaignId: string;
    text: string;
    filterStatus?: OutboundLeadStatus[];
    limit?: number;
    throttleMs?: number;
  }): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
    results: Array<{ leadId: string; to: string; ok: boolean; error?: string }>;
  }> {
    const {
      agentId,
      campaignId,
      text,
      filterStatus = [OutboundLeadStatus.QUEUED, OutboundLeadStatus.NEED_RETRY],
      limit = 500,
      throttleMs = 0,
    } = params;

    const campaign = await this.ensureCampaignForAgent(campaignId, agentId);
    this.ensureSendable(campaign);
    await this.ensureWhatsAppReady(agentId);

    const { data: leads } = await this.leadRepo.findMany({
      outboundCampaignId: campaignId,
      status: filterStatus,
      limit,
      page: 1,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    if (!leads.length) {
      return { attempted: 0, succeeded: 0, failed: 0, results: [] };
    }

    let succeeded = 0;
    const results: Array<{ leadId: string; to: string; ok: boolean; error?: string }> = [];

    for (const lead of leads) {
      const to = this.toJid(lead.phoneNumber);
      try {
        await (this.whatsapp as any).sendText(agentId, to, text);
        if (LEAD_SUCCESS_STATUS) {
          await this.leadRepo.setStatus(lead.id, LEAD_SUCCESS_STATUS);
        }
        results.push({ leadId: lead.id, to, ok: true });
        succeeded += 1;
      } catch (err: any) {
        this.logger.warn(`[broadcast] failed to send`, { leadId: lead.id, err: err?.message });
        await this.leadRepo.setStatus(lead.id, OutboundLeadStatus.NEED_RETRY);
        results.push({ leadId: lead.id, to, ok: false, error: err?.message ?? 'send failed' });
      }

      if (throttleMs > 0) {
        await new Promise((r) => setTimeout(r, throttleMs));
      }
    }

    if (succeeded > 0) {
      await this.repo.recordActivity(campaignId, {
        totalMessagesIncrement: succeeded,
        lastActivityAt: new Date(),
      });
      if (campaign.status === OutboundCampaignStatus.SCHEDULED) {
        await this.repo.setStatus(campaignId, { status: OutboundCampaignStatus.RUNNING });
      }
    }

    return {
      attempted: leads.length,
      succeeded,
      failed: leads.length - succeeded,
      results,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  computeStats(c: IOutboundCampaign): IOutboundCampaignStats {
    const unanswered = Math.max(0, c.leadsCount - c.answeredLeadsCount);
    const rate = c.leadsCount > 0 ? c.answeredLeadsCount / c.leadsCount : 0;
    return {
      totalMessages: c.totalMessages,
      leadsCount: c.leadsCount,
      answeredLeadsCount: c.answeredLeadsCount,
      unansweredLeadsCount: unanswered,
      leadAnswerRate: rate,
      lastActivityAt: c.lastActivityAt ?? null,
    };
  }

  private async ensureExists(id: string): Promise<IOutboundCampaign> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Campaign not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'checking campaign existence', { id });
    }
  }

  private async ensureCampaignForAgent(campaignId: string, agentId: string): Promise<IOutboundCampaign> {
    const campaign = await this.ensureExists(campaignId);
    if (campaign.agentId !== agentId) {
      throw new ForbiddenException('Campaign does not belong to the specified agent');
    }
    return campaign;
  }

  private ensureSendable(campaign: IOutboundCampaign) {
    if (!campaign.agentEnabled) {
      throw new BadRequestException('Agent is disabled for this campaign');
    }
    if (TERMINAL.has(campaign.status)) {
      throw new BadRequestException(`Cannot send messages on a ${campaign.status.toLowerCase()} campaign`);
    }
  }

  private async ensureWhatsAppReady(agentId: string) {
    const status = this.whatsapp.getStatus(agentId);
    if (status !== 'open') {
      throw new BadRequestException(`WhatsApp is not connected for this agent (status: ${status})`);
    }
  }

  private toJid(phone: string): string {
    const digits = (phone ?? '').replace(/\D+/g, '');
    if (!digits) throw new BadRequestException('Invalid phone number');
    return `${digits}@s.whatsapp.net`;
  }

  private validateName(name: string) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    if (trimmed.length > 120) throw new BadRequestException('Name max length is 120 characters');
  }

  private ensureFuture(d: Date, field: string) {
    if (d.getTime() <= Date.now()) {
      throw new BadRequestException(`${field} must be in the future`);
    }
  }

  private assertTransition(from: OutboundCampaignStatus, to: OutboundCampaignStatus) {
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Invalid status transition: ${from} → ${to}`);
    }
  }

  private mapAndThrow(error: any, when: string, meta?: Record<string, unknown>): never {
    this.logger.error(`[${when}] ${error?.message ?? error}`, meta ?? {});
    if (
      error instanceof NotFoundException ||
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ForbiddenException
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('A campaign with the same unique field already exists');
      if (error.code === 'P2025') throw new NotFoundException('Campaign not found');
      if (error.code === 'P2003') throw new BadRequestException('Invalid reference provided');
    }
    throw new InternalServerErrorException('Unexpected error while processing campaign');
  }
}
