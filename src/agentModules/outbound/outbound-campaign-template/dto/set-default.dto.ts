import { z } from 'zod';

export const SetDefaultTemplateSchema = z.object({
  isDefault: z.boolean().default(true),
});

export type SetDefaultTemplateDto = z.infer<typeof SetDefaultTemplateSchema>;
