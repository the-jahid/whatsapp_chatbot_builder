import { z } from 'zod';

export const RecordActivitySchema = z
  .object({
    // send only what you intend to change
    totalMessagesIncrement: z.coerce.number().int().positive().optional(),
    leadsCountIncrement: z.coerce.number().int().positive().optional(),
    answeredLeadsCountIncrement: z.coerce.number().int().positive().optional(),

    // optionally bump lastActivityAt explicitly
    lastActivityAt: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.totalMessagesIncrement !== undefined ||
      d.leadsCountIncrement !== undefined ||
      d.answeredLeadsCountIncrement !== undefined ||
      d.lastActivityAt !== undefined,
    { message: 'Provide at least one increment or lastActivityAt.' },
  );

export type RecordActivityInput = z.infer<typeof RecordActivitySchema>;
