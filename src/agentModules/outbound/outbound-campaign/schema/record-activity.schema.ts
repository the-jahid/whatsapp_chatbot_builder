import { z } from 'zod';

export const RecordActivitySchema = z.object({
  // Use one or more of these increments; defaults are applied if provided without a value.
  totalMessagesIncrement: z.coerce.number().int().positive().default(1).optional(),
  leadsCountIncrement: z.coerce.number().int().positive().default(1).optional(),
  answeredLeadsCountIncrement: z.coerce.number().int().positive().default(1).optional(),

  // Optionally bump lastActivityAt explicitly (otherwise your service can set it to now).
  lastActivityAt: z.coerce.date().optional(),
})
.refine(
  (d) =>
    d.totalMessagesIncrement !== undefined ||
    d.leadsCountIncrement !== undefined ||
    d.answeredLeadsCountIncrement !== undefined ||
    d.lastActivityAt !== undefined,
  { message: 'Provide at least one increment or lastActivityAt.' }
);

export type RecordActivityInput = z.infer<typeof RecordActivitySchema>;
