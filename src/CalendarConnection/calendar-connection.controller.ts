import {
  Controller,
  Get,
  Param,
  Delete,
  Patch,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CalendarConnectionService } from './calendar-connection.service';
import { UpdateCalendarConnectionDto } from './dto/calendar-connection.dto';
// NOTE: The following are examples of how you would secure the endpoints.
// You would need to implement your own AuthGuard and a decorator to extract the user.
// import { AuthGuard } from '../auth/auth.guard';
// import { User } from '../auth/user.decorator';

@Controller('calendar-connections')
// @UseGuards(AuthGuard) // Example: Secure all routes in this controller.
export class CalendarConnectionController {
  constructor(
    private readonly connectionService: CalendarConnectionService,
  ) {}

  /**
   * GET /calendar-connections
   * Retrieves a list of all connections for the authenticated user.
   * This endpoint returns an external-facing version of the data, omitting sensitive tokens.
   */
  @Get()
  findAll(/*@User('id') userId: string*/) {
    // In a real app, the userId would come from the authenticated user session.
    const userId = 'user-uuid-placeholder'; // Replace with actual user from request
    return this.connectionService.findAllByUserId(userId);
  }

  /**
   * GET /calendar-connections/:id
   * Retrieves a single calendar connection by its ID.
   * It ensures the connection belongs to the authenticated user.
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    /*@User('id') userId: string*/
  ) {
    const userId = 'user-uuid-placeholder'; // Replace with actual user from request
    // This internal method returns the full object, but we only send the safe version.
    const connection = await this.connectionService.findOne(id, userId);
    // Manually strip sensitive data before sending the response.
    const { accessToken, refreshToken, ...result } = connection;
    return result;
  }

  /**
   * PATCH /calendar-connections/:id
   * Updates a specific calendar connection (e.g., to set it as primary).
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateCalendarConnectionDto,
    /*@User('id') userId: string*/
  ) {
    const userId = 'user-uuid-placeholder'; // Replace with actual user from request
    return this.connectionService.update(id, updateDto, userId);
  }

  /**
   * DELETE /calendar-connections/:id
   * Deletes a calendar connection.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // Return a 204 No Content on successful deletion.
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    /*@User('id') userId: string*/
  ) {
    const userId = 'user-uuid-placeholder'; // Replace with actual user from request
    return this.connectionService.remove(id, userId);
  }
}
