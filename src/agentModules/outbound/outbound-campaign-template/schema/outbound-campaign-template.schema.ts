import { z } from 'zod';
import { TemplateStatus } from '@prisma/client';

/** Shared constraints */
const NameSchema = z.string().trim().min(1, 'Name is required').max(120);
const BodySchema = z.string().trim().min(1, 'Body is required').max(5000);
const LocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(10)
  .regex(/^[A-Za-z_/-]+$/, 'Invalid locale format (e.g., en or en_US)')
  .optional();

const VariablesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50, 'Too many variables')
  .default([]);

/** Create */
export const CreateOutboundCampaignTemplateSchema = z.object({
  name: NameSchema,
  body: BodySchema,
  variables: VariablesSchema,
  locale: LocaleSchema,
  status: z.nativeEnum(TemplateStatus).default(TemplateStatus.DRAFT),
  isDefault: z.boolean().optional().default(false),
});

/** Update (partial) */
export const UpdateOutboundCampaignTemplateSchema = z.object({
  name: NameSchema.optional(),
  body: BodySchema.optional(),
  variables: VariablesSchema.optional(),
  locale: LocaleSchema,
  status: z.nativeEnum(TemplateStatus).optional(),
  isDefault: z.boolean().optional(),
});
