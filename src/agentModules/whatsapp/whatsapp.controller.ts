import {
  Controller,
  Get,
  Param,
  Post,
  HttpException,
  HttpStatus,
  ParseUUIDPipe,
  Body,
  Patch,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';

// A simple DTO for the toggle request body
class ToggleAgentDto {
    isActive: boolean;
}

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('start/:agentId')
  @ApiOperation({ summary: 'Start WhatsApp connection and get QR code' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiResponse({ status: 201, description: 'Returns QR code data or connection status.' })
  async start(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      const result = await this.whatsappService.start(agentId);
      return {
        statusCode: HttpStatus.CREATED,
        ...result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to start WhatsApp service.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // --- NEW: Endpoint to toggle agent's active status ---
  @Patch('agent/:agentId/toggle')
  @ApiOperation({ summary: "Activate or deactivate an agent's chatbot functionality" })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiBody({ type: ToggleAgentDto })
  @ApiResponse({ status: 200, description: "Agent status updated successfully."})
  async toggleAgent(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() toggleDto: ToggleAgentDto,
  ) {
    if (typeof toggleDto.isActive !== 'boolean') {
        throw new HttpException('Invalid input: isActive must be a boolean.', HttpStatus.BAD_REQUEST);
    }
    try {
        const updatedAgent = await this.whatsappService.toggleAgentStatus(agentId, toggleDto.isActive);
        return {
            statusCode: HttpStatus.OK,
            message: `Agent ${updatedAgent.name} has been ${updatedAgent.isActive ? 'activated' : 'deactivated'}.`,
            data: updatedAgent,
        };
    } catch (error) {
        throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  // --- End of new endpoint ---

  @Get('status/:agentId')
  @ApiOperation({ summary: 'Get connection status for an agent' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  getStatus(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    const status = this.whatsappService.getStatus(agentId);
    return { statusCode: HttpStatus.OK, data: { status } };
  }

  @Post('logout/:agentId')
  @ApiOperation({ summary: 'Logout WhatsApp session for an agent' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  async logout(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    await this.whatsappService.logout(agentId);
    return { message: 'Logout process initiated.' };
  }
}
