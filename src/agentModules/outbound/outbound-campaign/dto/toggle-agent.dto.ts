import { z } from 'zod';
import { ToggleAgentSchema } from '../schema/outbound-campaign.schema';

export type ToggleAgentDto = z.infer<typeof ToggleAgentSchema>;
export { ToggleAgentSchema };
