import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AgentService, GetAllAgentsQuery, PaginatedAgentsResult } from './agent.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import { Agent, MemoryType } from '@prisma/client'; // Import MemoryType
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { createAgentSchema, updateAgentSchema } from './schemas/agent.schema';

@ApiTags('agents')
@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new agent' })
  @ApiResponse({ status: 201, description: 'The agent has been successfully created.' })
  @ApiResponse({ status: 409, description: 'Conflict. The API key or another unique field already exists.' })
  async create(
    @Body(new ZodValidationPipe(createAgentSchema)) createAgentDto: CreateAgentDto
  ): Promise<Agent> {
    return this.agentService.create(createAgentDto);
  }

  @Get('/user/:userId')
  @ApiOperation({ summary: 'Get all agents for a specific user by ID' })
  @ApiResponse({ status: 200, description: 'A paginated list of the user\'s agents.'})
  // UPDATED: Added ApiQuery to document the new memoryType filter
  @ApiQuery({ name: 'memoryType', enum: MemoryType, required: false, description: 'Filter agents by memory type.' })
  async findAllByUser(
    @Param('userId', ParseUUIDPipe) userId: string, 
    @Query() query: GetAllAgentsQuery
  ): Promise<PaginatedAgentsResult> {
    return this.agentService.getAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific agent by ID' })
  @ApiResponse({ status: 200, description: 'The agent record.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Agent> {
    return this.agentService.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent by ID' })
  @ApiResponse({ status: 200, description: 'The agent has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAgentSchema)) updateAgentDto: UpdateAgentDto
  ): Promise<Agent> {
    return this.agentService.update(id, updateAgentDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent by ID' })
  @ApiResponse({ status: 204, description: 'The agent has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.agentService.delete(id);
  }
}

