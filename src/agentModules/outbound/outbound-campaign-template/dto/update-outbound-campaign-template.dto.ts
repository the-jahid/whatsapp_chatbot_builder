import { z } from 'zod';
import { UpdateOutboundCampaignTemplateSchema } from '../schema/outbound-campaign-template.schema';

export type UpdateOutboundCampaignTemplateDto = z.infer<typeof UpdateOutboundCampaignTemplateSchema>;
