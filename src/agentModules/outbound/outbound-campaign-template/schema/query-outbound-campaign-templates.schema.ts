import { z } from 'zod';
import { TemplateStatus } from '@prisma/client';

export const TemplateOrderByEnum = z.enum(['createdAt', 'updatedAt', 'name']);
export const OrderEnum = z.enum(['asc', 'desc']);

export const QueryOutboundCampaignTemplatesSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().max(200).optional(),
  status: z.array(z.nativeEnum(TemplateStatus)).optional(),
  isDefault: z.coerce.boolean().optional(),
  orderBy: TemplateOrderByEnum.default('createdAt'),
  order: OrderEnum.default('desc'),
});
