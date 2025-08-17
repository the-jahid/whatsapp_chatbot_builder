import { z } from 'zod';
import { UpdateOutboundCampaignSchema } from '../schema/outbound-campaign.schema';

export type UpdateOutboundCampaignDto = z.infer<typeof UpdateOutboundCampaignSchema>;
export { UpdateOutboundCampaignSchema };
