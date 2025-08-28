import { z } from 'zod';
import { QueryOutboundCampaignTemplatesSchema } from '../schema/query-outbound-campaign-templates.schema';

export type QueryOutboundCampaignTemplatesDto = z.infer<typeof QueryOutboundCampaignTemplatesSchema>;
