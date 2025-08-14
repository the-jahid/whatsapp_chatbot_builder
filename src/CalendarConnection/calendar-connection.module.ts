import { Module } from '@nestjs/common';
import { CalendarConnectionService } from './calendar-connection.service';
import { CalendarConnectionController } from './calendar-connection.controller';
import { PrismaModule } from '../prisma/prisma.module'; // Adjust path if necessary

@Module({
  // Import any modules whose services are required by this module's components.
  // The PrismaModule is needed to provide the PrismaService to the CalendarConnectionService.
  imports: [PrismaModule],
  // Register the controller that defines the API endpoints for this module.
  controllers: [CalendarConnectionController],
  // Register the service that contains the business logic.
  providers: [CalendarConnectionService],
  // Export the service to make it available for dependency injection in other modules.
  exports: [CalendarConnectionService],
})
export class CalendarConnectionModule {}


