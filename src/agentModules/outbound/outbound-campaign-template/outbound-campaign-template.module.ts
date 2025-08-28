import { Module } from '@nestjs/common';
import { OutboundCampaignTemplateController } from './outbound-campaign-template.controller';
import { OutboundCampaignTemplateService } from './outbound-campaign-template.service';


import { OutboundCampaignTemplateRepository } from './respository/outbound-campaign-template.repository';

@Module({
  controllers: [OutboundCampaignTemplateController],
  providers: [
   
    OutboundCampaignTemplateService,
    OutboundCampaignTemplateRepository,
  ],
  exports: [
    OutboundCampaignTemplateService,
    OutboundCampaignTemplateRepository,
  ],
})
export class OutboundCampaignTemplateModule {}
