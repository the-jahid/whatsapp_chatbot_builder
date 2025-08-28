import { z } from 'zod';
import { TemplateStatus } from '@prisma/client';

export const SetTemplateStatusSchema = z.object({
  status: z.nativeEnum(TemplateStatus),
});

export type SetTemplateStatusDto = z.infer<typeof SetTemplateStatusSchema>;
