// src/agentModules/booking-settings/booking-settings.module.ts
import { Module } from '@nestjs/common';
import { BookingSettingsController } from './booking-settings.controller';
import { BookingSettingsService } from './booking-settings.service';
import { PrismaModule } from '../../prisma/prisma.module'; // ← adjust path if needed

@Module({
  imports: [PrismaModule],
  controllers: [BookingSettingsController],
  providers: [BookingSettingsService],
  exports: [BookingSettingsService],
})
export class BookingSettingsModule {}
