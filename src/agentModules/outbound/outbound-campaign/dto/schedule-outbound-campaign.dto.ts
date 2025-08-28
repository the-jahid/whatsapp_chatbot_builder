import { z } from 'zod';
import { ScheduleOutboundCampaignSchema } from '../schema/outbound-campaign.schema';

export type ScheduleOutboundCampaignDto = z.infer<typeof ScheduleOutboundCampaignSchema>;
export { ScheduleOutboundCampaignSchema };
