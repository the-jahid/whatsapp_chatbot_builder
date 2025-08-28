import { z } from 'zod';
import { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

const ANY_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const Name = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Max 120 chars');

// -------- CREATE (no agentId in body) --------
export const CreateOutboundCampaignSchema = z
  .object({
    name: Name,
    type: z.nativeEnum(OutboundCampaignType).default(OutboundCampaignType.SINGLE),
    status: z
      .nativeEnum(OutboundCampaignStatus)
      .default(OutboundCampaignStatus.DRAFT),
    agentEnabled: z.boolean().default(true),
    scheduledAt: z.coerce.date().optional(), // service enforces "future" where needed
    config: z.any().optional(), // JSONB
    stats: z.any().optional(), // JSONB
  })
  .strict();
export type CreateOutboundCampaignInput = z.infer<
  typeof CreateOutboundCampaignSchema
>;

// -------- UPDATE --------
export const UpdateOutboundCampaignSchema = z
  .object({
    name: Name.optional(),
    type: z.nativeEnum(OutboundCampaignType).optional(),
    status: z.nativeEnum(OutboundCampaignStatus).optional(),
    agentEnabled: z.boolean().optional(),
    // allow clearing with null
    scheduledAt: z.coerce.date().nullable().optional(),
    config: z.any().optional(),
    stats: z.any().optional(),
  })
  .strict();
export type UpdateOutboundCampaignInput = z.infer<
  typeof UpdateOutboundCampaignSchema
>;

// -------- SCHEDULE --------
export const ScheduleOutboundCampaignSchema = z
  .object({
    scheduledAt: z.coerce.date(),
  })
  .strict()
  .refine((d) => d.scheduledAt.getTime() > Date.now(), {
    message: 'scheduledAt must be in the future',
    path: ['scheduledAt'],
  });
export type ScheduleOutboundCampaignInput = z.infer<
  typeof ScheduleOutboundCampaignSchema
>;

// -------- TOGGLE --------
export const ToggleAgentSchema = z.object({ agentEnabled: z.boolean() }).strict();
export type ToggleAgentInput = z.infer<typeof ToggleAgentSchema>;

// -------- STATUS --------
export const SetStatusSchema = z
  .object({ status: z.nativeEnum(OutboundCampaignStatus) })
  .strict();
export type SetStatusInput = z.infer<typeof SetStatusSchema>;

// -------- ASSIGN TEMPLATE BODY --------
export const AssignTemplateSchema = z
  .object({
    // null clears, UUID assigns
    templateId: z.union([z.string().regex(ANY_UUID, 'Invalid UUID'), z.null()]),
    requireActive: z.boolean().optional().default(true),
  })
  .strict();
export type AssignTemplateInput = z.infer<typeof AssignTemplateSchema>;

// -------- PARAM SCHEMAS (optional; you use a pipe already) --------
export const AgentIdParamSchema = z
  .object({ agentId: z.string().regex(ANY_UUID, 'Invalid UUID') })
  .strict();
export type AgentIdParam = z.infer<typeof AgentIdParamSchema>;

export const CampaignIdParamSchema = z
  .object({ id: z.string().regex(ANY_UUID, 'Invalid UUID') })
  .strict();
export type CampaignIdParam = z.infer<typeof CampaignIdParamSchema>;



