import { z } from 'zod';
import { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

// Accept ANY UUID version (not v4-only)
const UUID_ANY = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID',
  );

const StatusOneOrMany = z
  .union([
    z.nativeEnum(OutboundCampaignStatus),
    z.array(z.nativeEnum(OutboundCampaignStatus)).nonempty(),
  ])
  .optional();

export const QueryOutboundCampaignsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),

    agentId: UUID_ANY.optional(), // ← relaxed UUID
    type: z.nativeEnum(OutboundCampaignType).optional(),
    status: StatusOneOrMany,
    q: z.string().trim().min(1).max(120).optional(), // search by name

    scheduledFrom: z.coerce.date().optional(),
    scheduledTo: z.coerce.date().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),

    sortBy: z
      .enum(['createdAt', 'scheduledAt', 'lastActivityAt', 'name', 'status'])
      .default('createdAt')
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  })
  .refine(
    (d) => !(d.scheduledFrom && d.scheduledTo) || d.scheduledFrom <= d.scheduledTo,
    { message: 'scheduledFrom must be <= scheduledTo', path: ['scheduledFrom'] },
  )
  .refine(
    (d) => !(d.createdFrom && d.createdTo) || d.createdFrom <= d.createdTo,
    { message: 'createdFrom must be <= createdTo', path: ['createdFrom'] },
  );

export type QueryOutboundCampaignsInput = z.infer<typeof QueryOutboundCampaignsSchema>;
