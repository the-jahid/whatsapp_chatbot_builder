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
  TemplateStatus,
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

import { OutboundLeadRepository } from '../outbound-lead/repository/outbound-lead.repository';
import { WhatsappService } from 'src/agentModules/whatsapp/whatsapp.service';
import { PrismaService } from 'src/prisma/prisma.service';

// ✅ Cron
import { Cron, CronExpression } from '@nestjs/schedule';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const TERMINAL = new Set<OutboundCampaignStatus>([
  OutboundCampaignStatus.COMPLETED,
  OutboundCampaignStatus.CANCELLED,
]);

// Works whether enum has MESSAGE_SUCCESSFUL or CALL_SUCCESSFUL
const LEAD_SUCCESS_STATUS: OutboundLeadStatus =
  (OutboundLeadStatus as any)['MESSAGE_SUCCESSFUL'] ??
  (OutboundLeadStatus as any)['CALL_SUCCESSFUL'] ??
  OutboundLeadStatus.IN_PROGRESS;

// Defaults for batched sending
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_THROTTLE_MS = 200;
const MAX_BATCHES_PER_TICK = 20; // safety: 20 * 50 = 1000 msgs per tick

// Config key for scheduled broadcast
const CFG_KEY = 'scheduledBroadcast';

type ScheduledBroadcastConfig = {
  templateId?: string | null; // if null/omitted → use assignedTemplate
  filterStatus?: OutboundLeadStatus[]; // default: [QUEUED]
  limit?: number; // cap total leads processed in a run
  batch?: { size?: number; intervalMs?: number }; // batching anti-ban

  /**
   * 📣 New pacing fields
   * - duration: human string "10m" | "24h" | "2d" | "30s"
   * - durationMs: parsed duration (ms)
   * - pacing: runtime tracking to spread the sends across the selected duration
   */
  duration?: string;
  durationMs?: number;
  pacing?: {
    startAtISO: string;            // when the schedule starts (ISO)
    endAtISO: string;              // startAt + durationMs (ISO)
    initialTotal?: number;         // pool size at first tick (snapshot of matching leads)
    sent?: number;                 // how many attempts have been made under this plan
    completed?: boolean;           // set when pacing window finished
  };
};

@Injectable()
export class OutboundCampaignService {
  private readonly logger = new Logger(OutboundCampaignService.name);

  // re-entrancy guard for cron
  private tickRunning = false;

  constructor(
    private readonly repo: OutboundCampaignRepository,
    private readonly leadRepo: OutboundLeadRepository,
    private readonly whatsapp: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // ✅ CRON WORKER
  // ---------------------------------------------------------------------------
  /**
   * Runs every 30 seconds by default. You can override timezone by setting
   * process.env.CRON_TZ (e.g., "Asia/Dhaka"). The tick is idempotent and guarded.
   *
   * App setup:
   *  - Install:  npm i @nestjs/schedule
   *  - Module:   ScheduleModule.forRoot()
   */
  @Cron(CronExpression.EVERY_30_SECONDS, {
    timeZone: process.env.CRON_TZ ?? 'UTC',
  })
  async handleScheduledBroadcastCron() {
    // Optional flag to disable via env if needed
    if (process.env.BROADCAST_CRON_DISABLED === 'true') return;

    if (this.tickRunning) {
      this.logger.warn('[cron] previous tick still running, skipping this one');
      return;
    }
    this.tickRunning = true;
    const started = Date.now();

    try {
      const result = await this.runScheduledTick();
      this.logger.log(
        `[cron] tick done in ${Date.now() - started}ms; scanned=${result.scanned}; processed=${result.processed.length}`,
      );
    } catch (err: any) {
      this.logger.error(`[cron] tick error: ${err?.message ?? err}`);
    } finally {
      this.tickRunning = false;
    }
  }

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
  // Actions
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
  // Assign / Read campaign template
  // ---------------------------------------------------------------------------

  async setAssignedTemplate(params: {
    agentId: string;
    campaignId: string;
    templateId: string | null;
    requireActive?: boolean;
  }): Promise<IOutboundCampaign> {
    const { agentId, campaignId, templateId, requireActive = true } = params;

    const campaign = await this.ensureCampaignForAgent(campaignId, agentId);

    // Clear assignment
    if (!templateId) {
      try {
        return await this.prisma.outboundCampaign.update({
          where: { id: campaign.id },
          data: { assignedTemplate: null },
        });
      } catch (e) {
        this.mapAndThrow(e, 'clearing assigned template', { campaignId });
      }
    }

    // Ensure template exists in this campaign (and is ACTIVE if required)
    const tpl = await this.prisma.outboundCampaignTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, outboundCampaignId: true, status: true },
    });
    if (!tpl || tpl.outboundCampaignId !== campaignId) {
      throw new NotFoundException('Template not found in this campaign');
    }
    if (requireActive && tpl.status !== TemplateStatus.ACTIVE) {
      throw new BadRequestException('Template must be ACTIVE to assign');
    }

    try {
      return await this.prisma.outboundCampaign.update({
        where: { id: campaign.id },
        data: { assignedTemplate: tpl.id },
      });
    } catch (e) {
      this.mapAndThrow(e, 'assigning template', { campaignId, templateId });
    }
  }

  async getAssignedTemplate(campaignId: string): Promise<{
    templateId: string | null;
    template: { id: string; name: string; status: TemplateStatus } | null;
  }> {
    const c = await this.prisma.outboundCampaign.findUnique({
      where: { id: campaignId },
      select: { assignedTemplate: true },
    });
    if (!c) throw new NotFoundException('Campaign not found');

    if (!c.assignedTemplate) {
      return { templateId: null, template: null };
    }
    const tpl = await this.prisma.outboundCampaignTemplate.findUnique({
      where: { id: c.assignedTemplate },
      select: { id: true, name: true, status: true },
    });
    return { templateId: c.assignedTemplate, template: tpl ?? null };
  }

  // ---------------------------------------------------------------------------
  // Broadcast scheduler (store settings + schedule start time)
  // ---------------------------------------------------------------------------

  /**
   * Persist scheduled broadcast settings under `campaign.config.scheduledBroadcast`,
   * set `scheduledAt`, and switch status to SCHEDULED (if DRAFT/SCHEDULED).
   *
   * Provide either:
   *  - startAt: Date (future)
   *  - startIn: "5m" | "2h" | "1d" | "30s"
   *
   * 📣 New: if `params.settings.duration` (e.g. "24h", "10m", "2d") is provided,
   * the cron will **pace** messages uniformly across that window.
   */
  async scheduleBroadcast(params: {
    agentId: string;
    campaignId: string;
    startAt?: Date;
    startIn?: string;
    settings?: ScheduledBroadcastConfig;
  }): Promise<IOutboundCampaign> {
    const { agentId, campaignId, startAt, startIn } = params;
    const campaign = await this.ensureCampaignForAgent(campaignId, agentId);

    const when =
      startAt ??
      (startIn ? new Date(Date.now() + this.parseHumanDuration(startIn)) : null);
    if (!when) throw new BadRequestException('Provide startAt (ISO) or startIn (e.g., "5m").');
    if (when.getTime() <= Date.now()) {
      throw new BadRequestException('Start time must be in the future');
    }

    // Build config
    const existingCfg = (campaign.config ?? {}) as Record<string, any>;

    let durationMs: number | undefined;
    if (params.settings?.duration) {
      durationMs = this.parseHumanDuration(params.settings.duration);
      if (durationMs <= 0) throw new BadRequestException('duration must be > 0');
    } else if (params.settings?.durationMs) {
      durationMs = params.settings.durationMs;
      if (durationMs <= 0) throw new BadRequestException('durationMs must be > 0');
    }

    const scheduledBroadcast: ScheduledBroadcastConfig = {
      templateId: params.settings?.templateId ?? null,
      filterStatus: params.settings?.filterStatus ?? [OutboundLeadStatus.QUEUED],
      limit: params.settings?.limit ?? undefined,
      batch: {
        size: params.settings?.batch?.size ?? DEFAULT_BATCH_SIZE,
        intervalMs: params.settings?.batch?.intervalMs ?? DEFAULT_THROTTLE_MS,
      },
      // pacing
      duration: params.settings?.duration,
      durationMs,
      pacing: durationMs
        ? {
            startAtISO: when.toISOString(),
            endAtISO: new Date(when.getTime() + durationMs).toISOString(),
            initialTotal: undefined,
            sent: 0,
            completed: false,
          }
        : undefined,
    };

    const newConfig = { ...existingCfg, [CFG_KEY]: scheduledBroadcast };

    const data: Prisma.OutboundCampaignUpdateInput = {
      config: newConfig as unknown as Prisma.InputJsonValue,
      scheduledAt: when,
    };

    if (
      campaign.status === OutboundCampaignStatus.DRAFT ||
      campaign.status === OutboundCampaignStatus.SCHEDULED
    ) {
      (data as any).status = OutboundCampaignStatus.SCHEDULED;
    }

    return this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Scheduled Outbound Messaging (worker/cron)
  // ---------------------------------------------------------------------------

  /**
   * Called by the cron worker. Scans SCHEDULED/RUNNING campaigns due by scheduledAt.
   * If a pacing duration is configured, messages are throttled to meet the target
   * cumulative sends at the current time within the pacing window.
   */
  async runScheduledTick(options?: {
    defaultBatchSize?: number;
    defaultThrottleMs?: number;
    maxBatchesPerCampaign?: number;
  }): Promise<{
    scanned: number;
    processed: Array<{ campaignId: string; attempted: number; succeeded: number; failed: number }>;
  }> {
    const now = new Date();
    const campaigns = await this.prisma.outboundCampaign.findMany({
      where: {
        agentEnabled: true,
        status: { in: [OutboundCampaignStatus.SCHEDULED, OutboundCampaignStatus.RUNNING] },
        scheduledAt: { lte: now },
      },
      select: {
        id: true,
        agentId: true,
        status: true,
        assignedTemplate: true,
        config: true,
        scheduledAt: true,
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });

    const processed: Array<{ campaignId: string; attempted: number; succeeded: number; failed: number }> = [];

    for (const c of campaigns) {
      try {
        const cfg: ScheduledBroadcastConfig = ((c.config ?? {}) as any)[CFG_KEY] ?? {};

        const batchSize = Math.max(1, cfg.batch?.size ?? options?.defaultBatchSize ?? DEFAULT_BATCH_SIZE);
        const throttleMs = Math.max(0, cfg.batch?.intervalMs ?? options?.defaultThrottleMs ?? DEFAULT_THROTTLE_MS);
        const maxBatches = Math.max(1, options?.maxBatchesPerCampaign ?? MAX_BATCHES_PER_TICK);
        const statusFilter = cfg.filterStatus?.length ? cfg.filterStatus : [OutboundLeadStatus.QUEUED];

        // ----- 📣 Pacing logic (duration window) -----
        let pacedLimitThisTick: number | undefined = undefined;
        let needPersistPacing = false;

        const pacing = cfg.pacing;
        const hasPacing = !!(cfg.durationMs && pacing?.startAtISO && pacing?.endAtISO);

        if (hasPacing) {
          const startAt = new Date(pacing!.startAtISO);
          const endAt = new Date(pacing!.endAtISO);
          const nowTs = Date.now();

          // On first tick, snapshot initial total matching leads (QUEUED/NEED_RETRY/etc. per filter)
          if (pacing!.initialTotal == null) {
            const initialTotal = await this.prisma.outboundLead.count({
              where: { outboundCampaignId: c.id, status: { in: statusFilter } },
            });
            (cfg.pacing as any).initialTotal = initialTotal;
            needPersistPacing = true;
          }

          const initialTotal = cfg.pacing!.initialTotal ?? 0;
          const alreadySent = cfg.pacing!.sent ?? 0;

          if (nowTs < startAt.getTime()) {
            // Not started yet; nothing to do this tick (defensive; normally cron filters this)
            pacedLimitThisTick = 0;
          } else if (nowTs >= endAt.getTime()) {
            // Pacing window ended; flush all remaining
            const remaining = await this.prisma.outboundLead.count({
              where: { outboundCampaignId: c.id, status: { in: statusFilter } },
            });
            pacedLimitThisTick = remaining > 0 ? remaining : 0;
            // Mark pacing completed (persist after run)
            if (!cfg.pacing!.completed) {
              (cfg.pacing as any).completed = true;
              needPersistPacing = true;
            }
          } else {
            // Within pacing window: compute target cumulative sends at this moment
            const durationMs = endAt.getTime() - startAt.getTime();
            const elapsedMs = nowTs - startAt.getTime();
            const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
            const targetCumulative = Math.floor(initialTotal * progress);

            let allowedNow = targetCumulative - alreadySent;
            if (allowedNow < 0) allowedNow = 0;

            // Don't allow more than actually remaining
            if (allowedNow > 0) {
              const remaining = await this.prisma.outboundLead.count({
                where: { outboundCampaignId: c.id, status: { in: statusFilter } },
              });
              allowedNow = Math.min(allowedNow, remaining);
            }
            pacedLimitThisTick = allowedNow;
          }
        }

        // Final limit to pass into the batched runner
        // - If pacing says 0, we skip sending
        // - If pacing is undefined, fall back to user-provided cfg.limit
        const finalLimit =
          pacedLimitThisTick !== undefined
            ? pacedLimitThisTick
            : cfg.limit ?? undefined;

        if (finalLimit === 0) {
          // Persist any pacing updates we might have set (e.g., initialTotal)
          if (needPersistPacing) {
            await this.persistScheduledBroadcastConfig(c.id, cfg);
          }
          processed.push({ campaignId: c.id, attempted: 0, succeeded: 0, failed: 0 });
          continue;
        }

        const res = await this.runCampaignBatched({
          agentId: c.agentId,
          campaignId: c.id,
          batchSize,
          throttleMs,
          maxBatches,
          limit: finalLimit,
          leadStatuses: statusFilter,
          templateId: (cfg.templateId ?? c.assignedTemplate) ?? null,
        });

        // Update pacing.sent with how many attempts we made this tick (tracks plan progress)
        if (hasPacing) {
          const prev = cfg.pacing!.sent ?? 0;
          (cfg.pacing as any).sent = prev + res.attempted;
          needPersistPacing = true;
        }

        if (needPersistPacing) {
          await this.persistScheduledBroadcastConfig(c.id, cfg);
        }

        processed.push({ campaignId: c.id, attempted: res.attempted, succeeded: res.succeeded, failed: res.failed });
      } catch (err) {
        this.logger.error(`[runScheduledTick] campaign failed`, { campaignId: c.id, err: (err as any)?.message });
      }
    }

    return { scanned: campaigns.length, processed };
  }

  /**
   * Run one campaign in batches respecting provided settings.
   */
  async runCampaignBatched(params: {
    agentId: string;
    campaignId: string;
    templateId?: string | null;
    leadStatuses?: OutboundLeadStatus[];
    limit?: number;
    batchSize?: number;
    throttleMs?: number;
    maxBatches?: number;
  }): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const { agentId, campaignId } = params;
    const batchSize = Math.max(1, params.batchSize ?? DEFAULT_BATCH_SIZE);
    const throttleMs = Math.max(0, params.throttleMs ?? DEFAULT_THROTTLE_MS);
    const maxBatches = Math.max(1, params.maxBatches ?? MAX_BATCHES_PER_TICK);
    const limit = params.limit ?? Number.POSITIVE_INFINITY;
    const leadStatuses =
      params.leadStatuses && params.leadStatuses.length
        ? params.leadStatuses
        : [OutboundLeadStatus.QUEUED];

    const campaign = await this.ensureCampaignForAgent(campaignId, agentId);
    this.ensureSendable(campaign);
    await this.ensureWhatsAppReady(agentId);

    // Choose template
    const template = await this.pickTemplateToUse(campaignId, params.templateId);
    if (!template) {
      throw new BadRequestException('No ACTIVE template available for this campaign');
    }

    // Move to RUNNING when we begin sending
    if (campaign.status === OutboundCampaignStatus.SCHEDULED) {
      await this.repo.setStatus(campaignId, { status: OutboundCampaignStatus.RUNNING });
    }

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < maxBatches; i++) {
      if (attempted >= limit) break;

      const remainingForRun = Math.max(0, Math.min(batchSize, limit - attempted));
      if (remainingForRun <= 0) break;

      const leads = await this.prisma.outboundLead.findMany({
        where: { outboundCampaignId: campaignId, status: { in: leadStatuses } },
        orderBy: { createdAt: 'asc' },
        take: remainingForRun,
      });

      if (!leads.length) break;

      let batchSucceeded = 0;

      for (const lead of leads) {
        if (attempted >= limit) break;
        attempted += 1;

        const to = this.toJid(lead.phoneNumber);
        const text = this.renderTemplate(template.body, template.variables ?? [], lead);

        try {
          await (this.whatsapp as any).sendText(agentId, to, text);

          await this.prisma.outboundLead.update({
            where: { id: lead.id },
            data: {
              status: LEAD_SUCCESS_STATUS,
              attemptsMade: { increment: 1 },
              lastAttemptAt: new Date(),
            } as any,
          });
          succeeded += 1;
          batchSucceeded += 1;
        } catch (err) {
          await this.prisma.outboundLead.update({
            where: { id: lead.id },
            data: {
              status: OutboundLeadStatus.NEED_RETRY,
              attemptsMade: { increment: 1 },
              lastAttemptAt: new Date(),
            } as any,
          });
          failed += 1;
          this.logger.warn(`[runCampaignBatched] send failed`, {
            campaignId,
            leadId: lead.id,
            err: (err as any)?.message,
          });
        }

        if (throttleMs > 0) await this.sleep(throttleMs);
      }

      // Increment only this batch's successes to avoid double-counting
      if (batchSucceeded > 0) {
        await this.repo.recordActivity(campaignId, {
          totalMessagesIncrement: batchSucceeded,
          lastActivityAt: new Date(),
        });
      }

      if (leads.length < remainingForRun) break; // exhausted pool
    }

    // If nothing left to send (QUEUED/NEED_RETRY), complete the campaign
    const pending = await this.prisma.outboundLead.count({
      where: {
        outboundCampaignId: campaignId,
        status: { in: [OutboundLeadStatus.QUEUED, OutboundLeadStatus.NEED_RETRY] },
      },
    });
    if (pending === 0) {
      await this.prisma.outboundCampaign.update({
        where: { id: campaignId },
        data: { status: OutboundCampaignStatus.COMPLETED, completedAt: new Date() },
      });
    }

    return { attempted, succeeded, failed };
  }

  // ---------------------------------------------------------------------------
  // Ad-hoc WhatsApp endpoints (manual)
  // ---------------------------------------------------------------------------

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

    const lead = await this.leadRepo.findById(leadId);
    if (!lead || lead.outboundCampaignId !== campaignId) {
      throw new NotFoundException('Lead not found in this campaign');
    }

    const to = this.toJid(lead.phoneNumber);
    try {
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
        await this.sleep(throttleMs);
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

  // --- template helpers ------------------------------------------------------

  private async pickTemplateToUse(
    campaignId: string,
    explicitTemplateId?: string | null,
  ): Promise<{ id: string; body: string; variables: string[] } | null> {
    const templateId =
      explicitTemplateId ??
      (await this.prisma.outboundCampaign.findUnique({
        where: { id: campaignId },
        select: { assignedTemplate: true },
      }))?.assignedTemplate ??
      null;

    if (!templateId) return null;

    const tpl = await this.prisma.outboundCampaignTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, body: true, status: true, variables: true },
    });
    if (!tpl || tpl.status !== TemplateStatus.ACTIVE) return null;

    return { id: tpl.id, body: tpl.body, variables: (tpl.variables as any) ?? [] };
  }

  /**
   * Simple {{var}} renderer. It pulls from:
   *  - lead scalar fields (directly on lead)
   *  - lead.customFields (JSONB) for intake values
   */
  private renderTemplate(body: string, variables: string[], lead: any): string {
    if (!body || !variables?.length) return body;

    const custom = (lead.customFields ?? {}) as Record<string, any>;
    const map = new Map<string, any>();

    for (const key of variables) {
      let val: any;
      if (key in lead) val = (lead as any)[key];
      else if (key in custom) val = custom[key];
      map.set(key, this.stringify(val));
    }

    return body.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_: string, k: string) => {
      return map.has(k) ? String(map.get(k)) : '';
    });
  }

  private stringify(v: any): string {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  private parseHumanDuration(s: string): number {
    // e.g., "30s", "5m", "2h", "1d"
    const m = String(s ?? '').trim().match(/^(\d+)\s*([smhd])$/i);
    if (!m) throw new BadRequestException('startIn/duration must look like "30s", "5m", "2h", or "1d"');
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    switch (unit) {
      case 's':
        return n * 1000;
      case 'm':
        return n * 60_000;
      case 'h':
        return n * 60 * 60_000;
      case 'd':
        return n * 24 * 60 * 60_000;
      default:
        throw new BadRequestException('Unsupported time unit');
    }
  }

  private async persistScheduledBroadcastConfig(campaignId: string, cfg: ScheduledBroadcastConfig) {
    // Merge back into the campaign.config[CFG_KEY]
    const current = await this.prisma.outboundCampaign.findUnique({
      where: { id: campaignId },
      select: { config: true },
    });
    const configObj = (current?.config ?? {}) as Record<string, any>;
    configObj[CFG_KEY] = cfg;
    await this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data: { config: configObj as unknown as Prisma.InputJsonValue },
    });
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
