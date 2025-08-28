import { z } from 'zod';
import { CreateOutboundCampaignSchema } from '../schema/outbound-campaign.schema';

export type CreateOutboundCampaignDto = z.infer<typeof CreateOutboundCampaignSchema>;
export { CreateOutboundCampaignSchema };
