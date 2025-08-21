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
  UsePipes,
  ValidationPipe,
  HttpCode,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class ToggleAgentDto {
  @ApiProperty({ description: 'Set true to activate, false to deactivate' })
  @IsBoolean()
  isActive: boolean;
}

class SendMessageDto {
  @ApiProperty({
    description: 'Destination phone (E.164-ish). Examples: +393491234567 or 393491234567',
    example: '+393491234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{6,18}$/, {
    message:
      'Invalid phone format. Provide digits with optional leading + (6–18 digits).',
  })
  to: string;

  @ApiProperty({
    description: 'Message body',
    example: 'Ciao! Questo è un messaggio inviato dal bot 🚀',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096, { message: 'Text must be at most 4096 characters.' })
  text: string;
}

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('start/:agentId')
  @ApiOperation({ summary: 'Start WhatsApp connection and (optionally) get QR code' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiCreatedResponse({
    description:
      'Fresh start: returns QR (when required) or open status after establishing a new connection.',
    schema: {
      example: {
        statusCode: 201,
        status: 'connecting',
        message: 'QR code received. Please scan.',
        qr: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      },
    },
  })
  @ApiOkResponse({
    description:
      'No-op or already in progress: returns current status and message without creating a duplicate start.',
    schema: {
      example: {
        statusCode: 200,
        status: 'connecting',
        message: 'Connection process is already underway.',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Failed to start WhatsApp service.' })
  async start(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      const result = await this.whatsappService.start(agentId);

      // If service says it was already running/connecting, respond 200
      const alreadyInProgress =
        result?.message?.toLowerCase().includes('already underway') ||
        result?.status === 'open' ||
        (result?.status === 'connecting' && !result?.qr);

      const statusCode = alreadyInProgress ? HttpStatus.OK : HttpStatus.CREATED;

      return {
        statusCode,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to start WhatsApp service.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Toggle agent active status (deactivate => logs out WhatsApp, activate => only flips flag, login happens via /start)
  @Patch('agent/:agentId/toggle')
  @ApiOperation({ summary: "Activate or deactivate an agent's chatbot functionality" })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: ToggleAgentDto })
  @ApiOkResponse({
    description: 'Agent status updated successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Agent Jane Doe has been activated.',
        data: {
          id: 'd6d9a0d6-5ad5-4d3e-9a2c-3d3183b7d2a5',
          name: 'Jane Doe',
          isActive: true,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid input for isActive.',
    schema: { example: { statusCode: 400, message: 'Invalid input: isActive must be a boolean.' } },
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to toggle agent status.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status/:agentId')
  @ApiOperation({ summary: 'Get connection status for an agent' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns the current WhatsApp connection status tracked in memory.',
    schema: { example: { statusCode: 200, data: { status: 'open' } } },
  })
  getStatus(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    const status = this.whatsappService.getStatus(agentId);
    return { statusCode: HttpStatus.OK, data: { status } };
  }

  @Post('logout/:agentId')
  @ApiOperation({ summary: 'Logout WhatsApp session for an agent' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Logout initiated.',
    schema: { example: { message: 'Logout process initiated.' } },
  })
  async logout(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    await this.whatsappService.logout(agentId);
    return { message: 'Logout process initiated.' };
  }

  // =============================
  // NEW: Send a text message
  // =============================
  @Post('send/:agentId')
  @ApiOperation({ summary: 'Send a WhatsApp text message to any number from an agent session' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: SendMessageDto })
  @ApiOkResponse({
    description: 'Message sent successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Message sent.',
        data: {
          to: '393491234567@s.whatsapp.net',
          messageId: 'BAE5F3C1E2A0CAB3...',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation error or session not open.',
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async sendMessage(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() body: SendMessageDto,
  ) {
    try {
      const result = await this.whatsappService.sendMessage(agentId, body.to, body.text);
      return {
        statusCode: HttpStatus.OK,
        message: 'Message sent.',
        data: result,
      };
    } catch (error: any) {
      // Service throws BadRequestException / NotFoundException with proper status when needed
      throw new HttpException(
        error?.message || 'Failed to send message.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}


