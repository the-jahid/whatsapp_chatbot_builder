import { z } from 'zod';
import { CreateOutboundCampaignTemplateSchema } from '../schema/outbound-campaign-template.schema';

export type CreateOutboundCampaignTemplateDto = z.infer<typeof CreateOutboundCampaignTemplateSchema>;
