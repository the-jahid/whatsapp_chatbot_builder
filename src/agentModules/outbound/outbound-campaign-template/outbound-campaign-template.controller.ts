// src/agent-modules/outbound-campaign-template/outbound-campaign-template.controller.ts
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

import { OutboundCampaignTemplateService } from './outbound-campaign-template.service';

// DTOs
import { CreateOutboundCampaignTemplateDto } from './dto/create-outbound-campaign-template.dto';
import { UpdateOutboundCampaignTemplateDto } from './dto/update-outbound-campaign-template.dto';
import { QueryOutboundCampaignTemplatesDto } from './dto/query-outbound-campaign-templates.dto';
import {
  SetDefaultTemplateDto,
  SetDefaultTemplateSchema,
} from './dto/set-default.dto';
import {
  SetTemplateStatusDto,
  SetTemplateStatusSchema,
} from './dto/set-status.dto';

// Zod Schemas
import {
  CreateOutboundCampaignTemplateSchema,
  UpdateOutboundCampaignTemplateSchema,
} from './schema/outbound-campaign-template.schema';
import { QueryOutboundCampaignTemplatesSchema } from './schema/query-outbound-campaign-templates.schema';

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

@Controller()
export class OutboundCampaignTemplateController {
  constructor(private readonly svc: OutboundCampaignTemplateService) {}

  /** Zod -> 400 with details */
  private validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // CREATE (campaignId in PATH)
  // POST /outbound-campaigns/:campaignId/templates
  // ---------------------------------------------------------------------------
  @Post('outbound-campaigns/:campaignId/templates')
  async createForCampaign(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: CreateOutboundCampaignTemplateDto,
  ) {
    const dto = this.validate(CreateOutboundCampaignTemplateSchema, body);
    return this.svc.create(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // LIST in a campaign
  // GET /outbound-campaigns/:campaignId/templates
  // ---------------------------------------------------------------------------
  @Get('outbound-campaigns/:campaignId/templates')
  async findMany(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Query() q: QueryOutboundCampaignTemplatesDto,
  ) {
    const dto = this.validate(QueryOutboundCampaignTemplatesSchema, q);
    return this.svc.findMany(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // NEW: Intake field names for a campaign
  // GET /outbound-campaigns/:campaignId/templates/fields
  // ---------------------------------------------------------------------------
  @Get('outbound-campaigns/:campaignId/templates/fields')
  async listIntakeFieldNames(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
  ): Promise<string[]> {
    return this.svc.listCampaignIntakeFieldNames(campaignId);
  }

  // ---------------------------------------------------------------------------
  // GET ONE / UPDATE / DELETE (by id)
  // ---------------------------------------------------------------------------

  // GET /templates/:id
  @Get('templates/:id')
  async findOne(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.findOne(id);
  }

  // PATCH /templates/:id
  @Patch('templates/:id')
  async update(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: UpdateOutboundCampaignTemplateDto,
  ) {
    const dto = this.validate(UpdateOutboundCampaignTemplateSchema, body);
    return this.svc.update(id, dto);
  }

  // DELETE /templates/:id
  @Delete('templates/:id')
  @HttpCode(204)
  async remove(@Param('id', new AnyUuidPipe()) id: string): Promise<void> {
    await this.svc.remove(id);
  }

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------

  // PATCH /templates/:id/status
  @Patch('templates/:id/status')
  async setStatus(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: SetTemplateStatusDto,
  ) {
    const dto = this.validate(SetTemplateStatusSchema, body);
    return this.svc.setStatus(id, dto.status);
  }

  // PATCH /templates/:id/default
  @Patch('templates/:id/default')
  async setDefault(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: SetDefaultTemplateDto,
  ) {
    const dto = this.validate(SetDefaultTemplateSchema, body);
    return this.svc.setDefault(id, dto.isDefault ?? true);
  }
}
