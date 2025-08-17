// src/agent-modules/outbound-campaign/outbound-campaign.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutboundCampaignService } from './outbound-campaign.service';
import { OutboundCampaignController } from './outbound-campaign.controller';
import { OutboundCampaignRepository } from './repository/outbound-campaign.repository';

// 👇 make sure these paths match your tree
import { OutboundLeadModule } from '../outbound-lead/outbound-lead.module';
import { WhatsappModule } from 'src/agentModules/whatsapp/whatsapp.module';

@Module({
  imports: [
    OutboundLeadModule,  // 👈 provides/export OutboundLeadRepository
    WhatsappModule,      // 👈 provides/export WhatsappService
  ],
  controllers: [OutboundCampaignController],
  providers: [PrismaService, OutboundCampaignRepository, OutboundCampaignService],
  exports: [OutboundCampaignService],
})
export class OutboundCampaignModule {}
