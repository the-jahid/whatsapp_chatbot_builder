import { TemplateStatus } from '@prisma/client';

export interface IOutboundCampaignTemplate {
  id: string;
  name: string;
  body: string;
  variables: string[];
  locale?: string | null;
  status: TemplateStatus;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;

  outboundCampaignId: string;
}




