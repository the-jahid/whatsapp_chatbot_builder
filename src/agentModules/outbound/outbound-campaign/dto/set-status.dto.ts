import { z } from 'zod';
import { SetStatusSchema } from '../schema/outbound-campaign.schema';

export type SetStatusDto = z.infer<typeof SetStatusSchema>;
export { SetStatusSchema };
