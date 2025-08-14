import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Adjust path to your PrismaService
import { CreateCalendarConnectionDto } from './dto/calendar-connection.dto';
import { UpdateCalendarConnectionDto } from './dto/calendar-connection.dto';
import { ExternalCalendarConnection } from './interface/calendar-connection.interface';


@Injectable()
export class CalendarConnectionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Creates a new calendar connection record in the database.
   * NOTE: In a production application, you MUST encrypt the accessToken and refreshToken
   * before storing them to protect user data.
   * @param createDto - The DTO containing the new connection data.
   * @returns The newly created CalendarConnection object.
   */
  async create(createDto: CreateCalendarConnectionDto) {
    // TODO: Implement encryption for accessToken and refreshToken here.
    return this.prisma.calendarConnection.create({
      data: createDto,
    });
  }

  /**
   * Retrieves all calendar connections for a specific user, formatted for external use.
   * This method explicitly omits sensitive tokens.
   * @param userId - The ID of the user whose connections to retrieve.
   * @returns A promise that resolves to an array of ExternalCalendarConnection objects.
   */
  async findAllByUserId(userId: string): Promise<ExternalCalendarConnection[]> {
    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId },
    });

    // Map the full prisma model to the external-facing interface to strip sensitive data.
    return connections.map((conn) => ({
      id: conn.id,
      provider: conn.provider,
      accountEmail: conn.accountEmail,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
      calendarId: conn.calendarId,
      isPrimary: conn.isPrimary,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      userId: conn.userId,
    }));
  }

  /**
   * Finds a single, complete calendar connection record by its ID.
   * This method is for internal use as it returns sensitive tokens.
   * It ensures that the connection belongs to the specified user.
   * @param id - The ID of the calendar connection.
   * @param userId - The ID of the user who must own the connection.
   * @returns The full CalendarConnection object.
   * @throws NotFoundException if the connection doesn't exist or belong to the user.
   */
  async findOne(id: string, userId: string) {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { id, userId },
    });

    if (!connection) {
      throw new NotFoundException(`Connection with ID ${id} not found.`);
    }
    return connection;
  }

  /**
   * Updates a calendar connection.
   * @param id - The ID of the connection to update.
   * @param updateDto - The DTO with the fields to update.
   * @param userId - The ID of the user who owns the connection.
   * @returns The updated CalendarConnection object.
   */
  async update(id: string, updateDto: UpdateCalendarConnectionDto, userId: string) {
    // First, verify ownership by trying to find the connection.
    await this.findOne(id, userId);

    return this.prisma.calendarConnection.update({
      where: { id },
      data: updateDto,
    });
  }

  /**
   * Removes a calendar connection from the database.
   * @param id - The ID of the connection to remove.
   * @param userId - The ID of the user who owns the connection.
   */
  async remove(id: string, userId: string) {
    // Verify ownership before deleting.
    const connection = await this.findOne(id, userId);

    // TODO: In a real app, call the GoogleApiService to revoke the refresh token
    // before deleting the record from the database.
    // Example: await this.googleApiService.revokeToken(connection.refreshToken);

    await this.prisma.calendarConnection.delete({
      where: { id },
    });
  }
}
