import { Module } from '@nestjs/common';
import { AppointmentLeadItemController } from './appointment-lead-item.controller';
import { AppointmentLeadItemService } from './appointment-lead-item.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [AppointmentLeadItemController],
  providers: [AppointmentLeadItemService, PrismaService],
  exports: [AppointmentLeadItemService],
})
export class AppointmentLeadItemModule {}
