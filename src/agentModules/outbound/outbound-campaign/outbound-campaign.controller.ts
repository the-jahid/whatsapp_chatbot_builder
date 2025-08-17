// src/agent-modules/outbound-campaign/outbound-campaign.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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

// DTO types
import { CreateOutboundCampaignDto } from './dto/create-outbound-campaign.dto';
import { UpdateOutboundCampaignDto } from './dto/update-outbound-campaign.dto';
import { ScheduleOutboundCampaignDto } from './dto/schedule-outbound-campaign.dto';
import { ToggleAgentDto } from './dto/toggle-agent.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { QueryOutboundCampaignsDto } from './dto/query-outbound-campaigns.dto';
import { RecordActivityDto } from './dto/record-activity.dto';

// Zod schemas (runtime validation)
import {
  CreateOutboundCampaignSchema,
  UpdateOutboundCampaignSchema,
  ScheduleOutboundCampaignSchema,
  ToggleAgentSchema,
  SetStatusSchema,
} from './schema/outbound-campaign.schema';
import { QueryOutboundCampaignsSchema } from './schema/query-outbound-campaigns.schema';
import { RecordActivitySchema } from './schema/record-activity.schema';

/**
 * Pipe that allows ANY UUID version (3/4/5/7), trims whitespace.
 * Swap to Nest's ParseUUIDPipe({ version: '4' }) if you want v4-only later.
 */
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
  .union([
    z.nativeEnum(OutboundLeadStatus),
    z.array(z.nativeEnum(OutboundLeadStatus)).nonempty(),
  ])
  .optional();

const BroadcastSchema = z.object({
  text: z.string().trim().min(1, 'text is required'),
  filterStatus: LeadStatusOneOrMany,              // default handled in service
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  throttleMs: z.coerce.number().int().min(0).max(60000).optional(),
});
type BroadcastInput = z.infer<typeof BroadcastSchema>;

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
    @Body() body: CreateOutboundCampaignDto, // no agentId in body
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
  async remove(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.remove(id);
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
  // NEW: WhatsApp send endpoints
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

    // normalize single status into array for service
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
}
