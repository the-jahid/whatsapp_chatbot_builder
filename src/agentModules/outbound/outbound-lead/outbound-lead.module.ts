// src/agent-modules/outbound-lead/outbound-lead.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutboundLeadRepository } from './repository/outbound-lead.repository';
import { OutboundLeadService } from './outbound-lead.service';
import { OutboundLeadController } from './outbound-lead.controller'; // if present
import { LeadCustomFieldIntakeModule } from '../lead-custom-field-intake/lead-custom-field-intake.module';

@Module({
  imports: [
    LeadCustomFieldIntakeModule,   // 👈 provides LeadCustomFieldIntakeService
  ],
  controllers: [OutboundLeadController], // or []
  providers: [PrismaService, OutboundLeadRepository, OutboundLeadService],
  exports: [
    OutboundLeadRepository,        // so other modules (campaign) can use it
    OutboundLeadService,           // optional
  ],
})

export class OutboundLeadModule {}




