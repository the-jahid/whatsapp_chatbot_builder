import { z } from 'zod';
import { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

const UUID_V4 = z.string().uuid(); // for IDs in body if ever needed
const Name = z.string().trim().min(1, 'Name is required').max(120, 'Max 120 chars');

// -------- CREATE (no agentId in body) --------
export const CreateOutboundCampaignSchema = z.object({
  name: Name,
  type: z.nativeEnum(OutboundCampaignType).default(OutboundCampaignType.SINGLE).optional(),
  status: z.nativeEnum(OutboundCampaignStatus).default(OutboundCampaignStatus.DRAFT).optional(),
  agentEnabled: z.boolean().default(true).optional(),
  scheduledAt: z.coerce.date().optional(),
  config: z.any().optional(), // JSONB
  stats: z.any().optional(),  // JSONB
});
export type CreateOutboundCampaignInput = z.infer<typeof CreateOutboundCampaignSchema>;

// -------- UPDATE --------
export const UpdateOutboundCampaignSchema = z.object({
  name: Name.optional(),
  type: z.nativeEnum(OutboundCampaignType).optional(),
  status: z.nativeEnum(OutboundCampaignStatus).optional(),
  agentEnabled: z.boolean().optional(),
  scheduledAt: z.coerce.date().nullable().optional(), // allow clearing by sending null
  config: z.any().optional(),
  stats: z.any().optional(),
});
export type UpdateOutboundCampaignInput = z.infer<typeof UpdateOutboundCampaignSchema>;

// -------- SCHEDULE --------
export const ScheduleOutboundCampaignSchema = z.object({
  scheduledAt: z.coerce.date(),
}).refine(d => d.scheduledAt.getTime() > Date.now(), {
  message: 'scheduledAt must be in the future',
  path: ['scheduledAt'],
});
export type ScheduleOutboundCampaignInput = z.infer<typeof ScheduleOutboundCampaignSchema>;

// -------- TOGGLE --------
export const ToggleAgentSchema = z.object({
  agentEnabled: z.boolean(),
});
export type ToggleAgentInput = z.infer<typeof ToggleAgentSchema>;

// -------- STATUS --------
export const SetStatusSchema = z.object({
  status: z.nativeEnum(OutboundCampaignStatus),
});
export type SetStatusInput = z.infer<typeof SetStatusSchema>;

// -------- PARAM SCHEMAS (optional; you’re using a pipe already) --------
// If you want Zod validation for path params too, keep these.
// For broad UUID acceptance, use a regex instead of z.uuid().
export const AgentIdParamSchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid UUID'),
});
export type AgentIdParam = z.infer<typeof AgentIdParamSchema>;

export const CampaignIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid UUID'),
});
export type CampaignIdParam = z.infer<typeof CampaignIdParamSchema>;
