import { z } from 'zod';
import { QueryOutboundCampaignsSchema } from '../schema/query-outbound-campaigns.schema';

export type QueryOutboundCampaignsDto = z.infer<typeof QueryOutboundCampaignsSchema>;
export { QueryOutboundCampaignsSchema };
