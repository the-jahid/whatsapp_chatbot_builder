import { z } from 'zod';
import { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

// Accept ANY UUID version (not v4-only)
const ANY_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Accepts a single status or an array, returns a normalized array (or undefined). */
const StatusOneOrMany = z
  .union([
    z.nativeEnum(OutboundCampaignStatus),
    z.array(z.nativeEnum(OutboundCampaignStatus)).nonempty(),
  ])
  .optional()
  .transform((v) => (v == null ? undefined : Array.isArray(v) ? v : [v]));

export const QueryOutboundCampaignsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),

    agentId: z.string().regex(ANY_UUID, 'Invalid UUID').optional(),
    type: z.nativeEnum(OutboundCampaignType).optional(),
    status: StatusOneOrMany, // → OutboundCampaignStatus[] | undefined
    q: z
      .string()
      .trim()
      .max(120, 'Max 120 chars')
      .optional()
      .transform((s) => (s ? s : undefined)), // empty -> undefined

    scheduledFrom: z.coerce.date().optional(),
    scheduledTo: z.coerce.date().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),

    sortBy: z
      .enum(['createdAt', 'scheduledAt', 'lastActivityAt', 'name', 'status'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  .refine(
    (d) => !(d.scheduledFrom && d.scheduledTo) || d.scheduledFrom <= d.scheduledTo,
    { message: 'scheduledFrom must be <= scheduledTo', path: ['scheduledFrom'] },
  )
  .refine(
    (d) => !(d.createdFrom && d.createdTo) || d.createdFrom <= d.createdTo,
    { message: 'createdFrom must be <= createdTo', path: ['createdFrom'] },
  );

export type QueryOutboundCampaignsInput = z.infer<typeof QueryOutboundCampaignsSchema>;
