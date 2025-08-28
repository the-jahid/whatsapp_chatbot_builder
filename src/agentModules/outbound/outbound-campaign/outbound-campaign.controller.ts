// src/agent-modules/outbound-campaign/outbound-campaign.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  PipeTransform,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { OutboundLeadStatus } from '@prisma/client';

import { OutboundCampaignService } from './outbound-campaign.service';

// DTOs
import { CreateOutboundCampaignDto } from './dto/create-outbound-campaign.dto';
import { UpdateOutboundCampaignDto } from './dto/update-outbound-campaign.dto';
import { ScheduleOutboundCampaignDto } from './dto/schedule-outbound-campaign.dto';
import { ToggleAgentDto } from './dto/toggle-agent.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { QueryOutboundCampaignsDto } from './dto/query-outbound-campaigns.dto';
import { RecordActivityDto } from './dto/record-activity.dto';

// Zod Schemas (runtime validation)
import {
  CreateOutboundCampaignSchema,
  UpdateOutboundCampaignSchema,
  ScheduleOutboundCampaignSchema,
  ToggleAgentSchema,
  SetStatusSchema,
  AssignTemplateSchema, // (templateId?: UUID | null, requireActive?: boolean)
} from './schema/outbound-campaign.schema';
import { QueryOutboundCampaignsSchema } from './schema/query-outbound-campaigns.schema';
import { RecordActivitySchema } from './schema/record-activity.schema';

/** Accept ANY UUID version; trims input before checking */
@Injectable()
class AnyUuidPipe implements PipeTransform<string> {
  private readonly re =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  transform(value: string): string {
    const v = (value ?? '').trim();
    if (!this.re.test(v)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return v;
  }
}

/** Bodies for WhatsApp send endpoints */
const SendToLeadSchema = z.object({
  text: z.string().trim().min(1, 'text is required'),
});
type SendToLeadInput = z.infer<typeof SendToLeadSchema>;

const LeadStatusOneOrMany = z
  .union([z.nativeEnum(OutboundLeadStatus), z.array(z.nativeEnum(OutboundLeadStatus)).nonempty()])
  .optional();

const BroadcastSchema = z.object({
  text: z.string().trim().min(1, 'text is required'),
  filterStatus: LeadStatusOneOrMany, // defaults handled in service
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  throttleMs: z.coerce.number().int().min(0).max(60000).optional(),
});
type BroadcastInput = z.infer<typeof BroadcastSchema>;

/**
 * Schedule-broadcast body (inline schema)
 * One of `startAt` (ISO datetime) or `startIn` (e.g., "5m", "2h", "1d", "30s") is required.
 * If `useAssignedTemplate = true`, we ignore `templateId` and use the campaign's assigned template.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ScheduleBroadcastSchema = z
  .object({
    // when
    startAt: z.coerce.date().optional(),
    startIn: z
      .string()
      .trim()
      .regex(/^\d+\s*[smhd]$/i, 'Use formats like "30s", "5m", "2h", or "1d"')
      .optional(),

    // template selection
    useAssignedTemplate: z.boolean().default(true).optional(),
    templateId: z.string().trim().regex(UUID_RE, 'templateId must be a UUID').optional(),

    // selection & caps
    filterStatus: z.array(z.nativeEnum(OutboundLeadStatus)).nonempty().optional(), // defaults to only QUEUED in service
    limit: z.coerce.number().int().min(1).max(100000).optional(),

    // batching (anti-ban)
    batch: z
      .object({
        size: z.coerce.number().int().min(1).max(1000).optional(),
        intervalMs: z.coerce.number().int().min(0).max(60000).optional(),
      })
      .optional(),

    // New fields for pacing
    duration: z.string().optional(), // e.g., "10m", "24h", "2d"
  })
  .refine((d) => !!d.startAt || !!d.startIn, {
    message: 'Provide either startAt or startIn',
    path: ['startAt'],
  })
  .refine((d) => !(d.startAt && d.startIn), {
    message: 'Provide only one of startAt or startIn',
    path: ['startAt'],
  });
type ScheduleBroadcastInput = z.infer<typeof ScheduleBroadcastSchema>;

type AssignTemplateInput = z.infer<typeof AssignTemplateSchema>;

@Controller()
export class OutboundCampaignController {
  constructor(private readonly svc: OutboundCampaignService) {}

  // Helper: Zod → 400
  private validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // CREATE (agentId in PATH)
  // POST /agents/:agentId/outbound-campaigns
  // ---------------------------------------------------------------------------
  @Post('agents/:agentId/outbound-campaigns')
  async createForAgent(
    @Param('agentId', new AnyUuidPipe()) agentId: string,
    @Body() body: CreateOutboundCampaignDto,
  ) {
    const dto = this.validate(CreateOutboundCampaignSchema, body);
    return this.svc.create(agentId, dto);
  }

  // ---------------------------------------------------------------------------
  // LIST / GET ONE
  // ---------------------------------------------------------------------------

  // GET /outbound-campaigns
  @Get('outbound-campaigns')
  async findMany(@Query() q: QueryOutboundCampaignsDto) {
    const dto = this.validate(QueryOutboundCampaignsSchema, q);
    return this.svc.findMany(dto);
  }

  // GET /outbound-campaigns/:id
  @Get('outbound-campaigns/:id')
  async findOne(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // UPDATE / DELETE
  // ---------------------------------------------------------------------------

  // PATCH /outbound-campaigns/:id
  @Patch('outbound-campaigns/:id')
  async update(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: UpdateOutboundCampaignDto,
  ) {
    const dto = this.validate(UpdateOutboundCampaignSchema, body);
    return this.svc.update(id, dto);
  }

  // DELETE /outbound-campaigns/:id
  @Delete('outbound-campaigns/:id')
  @HttpCode(204)
  async remove(@Param('id', new AnyUuidPipe()) id: string): Promise<void> {
    await this.svc.remove(id);
  }

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------

  // PATCH /outbound-campaigns/:id/schedule
  @Patch('outbound-campaigns/:id/schedule')
  async schedule(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: ScheduleOutboundCampaignDto,
  ) {
    const dto = this.validate(ScheduleOutboundCampaignSchema, body);
    return this.svc.schedule(id, dto);
  }

  // PATCH /outbound-campaigns/:id/toggle
  @Patch('outbound-campaigns/:id/toggle')
  async toggleAgent(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: ToggleAgentDto,
  ) {
    const dto = this.validate(ToggleAgentSchema, body);
    return this.svc.toggleAgent(id, dto.agentEnabled);
  }

  // PATCH /outbound-campaigns/:id/status
  @Patch('outbound-campaigns/:id/status')
  async setStatus(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: SetStatusDto,
  ) {
    const dto = this.validate(SetStatusSchema, body);
    return this.svc.setStatus(id, dto.status);
  }

  // PATCH /outbound-campaigns/:id/record
  @Patch('outbound-campaigns/:id/record')
  async recordActivity(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: RecordActivityDto,
  ) {
    const dto = this.validate(RecordActivitySchema, body);
    return this.svc.recordActivity(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Assign / Read assigned template
  // ---------------------------------------------------------------------------

  // PATCH /agents/:agentId/outbound-campaigns/:campaignId/assigned-template
  @Patch('agents/:agentId/outbound-campaigns/:campaignId/assigned-template')
  async setAssignedTemplate(
    @Param('agentId', new AnyUuidPipe()) agentId: string,
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: AssignTemplateInput,
  ) {
    const dto = this.validate(AssignTemplateSchema, body);
    return this.svc.setAssignedTemplate({
      agentId,
      campaignId,
      templateId: dto.templateId ?? null, // null clears the assignment
      requireActive: dto.requireActive ?? true,
    });
  }

  // GET /agents/:agentId/outbound-campaigns/:campaignId/assigned-template
  @Get('agents/:agentId/outbound-campaigns/:campaignId/assigned-template')
  async getAssignedTemplate(
    @Param('agentId', new AnyUuidPipe()) _agentId: string, // ownership can be enforced via guard or service
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
  ) {
    return this.svc.getAssignedTemplate(campaignId);
  }

  // ---------------------------------------------------------------------------
  // WhatsApp send endpoints (manual)
  // ---------------------------------------------------------------------------

  // POST /agents/:agentId/outbound-campaigns/:campaignId/send/lead/:leadId
  @Post('agents/:agentId/outbound-campaigns/:campaignId/send/lead/:leadId')
  async sendToLead(
    @Param('agentId', new AnyUuidPipe()) agentId: string,
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Param('leadId', new AnyUuidPipe()) leadId: string,
    @Body() body: SendToLeadInput,
  ) {
    const dto = this.validate(SendToLeadSchema, body);
    return this.svc.sendToLead({ agentId, campaignId, leadId, text: dto.text });
  }

  // POST /agents/:agentId/outbound-campaigns/:campaignId/broadcast
  @Post('agents/:agentId/outbound-campaigns/:campaignId/broadcast')
  async broadcast(
    @Param('agentId', new AnyUuidPipe()) agentId: string,
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: BroadcastInput,
  ) {
    const dto = this.validate(BroadcastSchema, body);

    // normalize single status → array
    const filterStatus = Array.isArray(dto.filterStatus)
      ? dto.filterStatus
      : dto.filterStatus
      ? [dto.filterStatus]
      : undefined;

    return this.svc.broadcast({
      agentId,
      campaignId,
      text: dto.text,
      filterStatus,
      limit: dto.limit,
      throttleMs: dto.throttleMs,
    });
  }

  // ---------------------------------------------------------------------------
  // Schedule broadcast (deferred, batched auto-send)
  // ---------------------------------------------------------------------------

  // POST /agents/:agentId/outbound-campaigns/:campaignId/broadcast/schedule
  @Post('agents/:agentId/outbound-campaigns/:campaignId/broadcast/schedule')
  @HttpCode(202) // Accepted: scheduled for future execution
  async scheduleBroadcast(
    @Param('agentId', new AnyUuidPipe()) agentId: string,
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: ScheduleBroadcastInput,
  ) {
    const dto = this.validate(ScheduleBroadcastSchema, body);

    // If the caller says to use assignedTemplate, ignore templateId.
    const settings = {
      templateId: dto.useAssignedTemplate ? null : dto.templateId ?? null,
      filterStatus: dto.filterStatus,
      limit: dto.limit,
      batch: dto.batch,
      duration: dto.duration, // Added duration field
    };

    return this.svc.scheduleBroadcast({
      agentId,
      campaignId,
      startAt: dto.startAt,
      startIn: dto.startIn,
      settings,
    });
  }
}
