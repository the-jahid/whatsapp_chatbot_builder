// ===================================================
// src/agent/agent.controller.ts
// ===================================================
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
  Sse,
  MessageEvent,
  BadRequestException,
} from '@nestjs/common';
import {
  AgentService,
  GetAllAgentsQuery,
  PaginatedAgentsResult,
} from './agent.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import {
  Agent,
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiProduces,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import {
  createAgentSchema,
  updateAgentSchema,
} from './schemas/agent.schema';

// Zod
import { z } from 'zod';

// RxJS for SSE
import { Observable, from, map } from 'rxjs';

const SORTABLE_FIELDS = [
  'id',
  'name',
  'prompt',
  'apiKey',
  'isActive',
  'isLeadsActive',
  'isEmailActive',
  'isKnowledgebaseActive',
  'isBookingActive',
  'memoryType',
  'modelType',
  'createdAt',
  'updatedAt',
] as const;

// ---------- Zod schemas for chat ----------
const chatRequestSchema = z.object({
  threadId: z.string().min(1).optional(), // optional; service can default if you add that behavior
  message: z.string().min(1, 'message cannot be empty'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  historyLimit: z.number().int().positive().max(50).optional(),
  systemPromptOverride: z.string().optional(),
  persist: z.boolean().optional(),
});
type ChatRequestDto = z.infer<typeof chatRequestSchema>;

// For SSE, use query strings (GET cannot reliably have a body)
const chatStreamQuerySchema = z.object({
  threadId: z.string().min(1).optional(),
  message: z.string().min(1, 'message cannot be empty'),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  historyLimit: z.coerce.number().int().positive().max(50).optional(),
  systemPromptOverride: z.string().optional(),
  persist: z.coerce.boolean().optional(),
});
type ChatStreamQueryDto = z.infer<typeof chatStreamQuerySchema>;

const clearThreadSchema = z.object({
  threadId: z.string().min(1),
});
type ClearThreadDto = z.infer<typeof clearThreadSchema>;

@ApiTags('agents')
@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  // ------------------------------ Create ------------------------------
  @Post()
  @ApiOperation({ summary: 'Create a new agent' })
  @ApiCreatedResponse({
    description: 'The agent has been successfully created.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        // ... Swagger will infer the rest from model if you use @ApiExtraModels; this is a minimal shape
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({
    status: 409,
    description: 'Conflict. A unique field (e.g., apiKey) already exists.',
  })
  async create(
    @Body(new ZodValidationPipe(createAgentSchema))
    createAgentDto: CreateAgentDto,
  ): Promise<Agent> {
    return this.agentService.create(createAgentDto);
  }

  // ------------------------------ List (by user) ------------------------------
  @Get('/user/:userId')
  @ApiOperation({ summary: 'Get all agents for a specific user by ID' })
  @ApiOkResponse({
    description: "A paginated list of the user's agents.",
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        totalPages: { type: 'number' },
      },
    },
  })
  // Pagination & sorting
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'limit', required: false, example: '10' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: SORTABLE_FIELDS,
    description: 'Sortable fields',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
  })
  // Text filters
  @ApiQuery({ name: 'id', required: false, description: 'Filter by ID (contains, case-insensitive)' })
  @ApiQuery({ name: 'name', required: false, description: 'Filter by name (contains, case-insensitive)' })
  @ApiQuery({ name: 'prompt', required: false, description: 'Filter by prompt (contains, case-insensitive)' })
  @ApiQuery({ name: 'apiKey', required: false, description: 'Filter by apiKey (contains, case-insensitive)' })
  // Boolean filters
  @ApiQuery({ name: 'isActive', required: false, description: 'true/false' })
  @ApiQuery({ name: 'isLeadsActive', required: false, description: 'true/false' })
  @ApiQuery({ name: 'isEmailActive', required: false, description: 'true/false' })
  @ApiQuery({ name: 'isKnowledgebaseActive', required: false, description: 'true/false' })
  @ApiQuery({ name: 'isBookingActive', required: false, description: 'true/false' })
  // Enum filters
  @ApiQuery({ name: 'memoryType', required: false, enum: MemoryType, description: 'Filter by memory type' })
  @ApiQuery({ name: 'modelType', required: false, enum: AIModel, description: 'Filter by model provider' })
  @ApiQuery({
    name: 'openAIModel',
    required: false,
    enum: OpenAIModel,
    description: 'Filter by OpenAI model (only meaningful with modelType=CHATGPT)',
  })
  @ApiQuery({
    name: 'geminiModel',
    required: false,
    enum: GeminiModel,
    description: 'Filter by Gemini model (only meaningful with modelType=GEMINI)',
  })
  @ApiQuery({
    name: 'claudeModel',
    required: false,
    enum: ClaudeModel,
    description: 'Filter by Claude model (only meaningful with modelType=CLAUDE)',
  })
  async findAllByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: GetAllAgentsQuery,
  ): Promise<PaginatedAgentsResult> {
    return this.agentService.getAll(userId, query);
  }

  // ------------------------------ Read (by id) ------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific agent by ID' })
  @ApiOkResponse({ description: 'The agent record.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Agent> {
    return this.agentService.getById(id);
  }

  // ------------------------------ Update ------------------------------
  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent by ID' })
  @ApiOkResponse({ description: 'The agent has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAgentSchema))
    updateAgentDto: UpdateAgentDto,
  ): Promise<Agent> {
    return this.agentService.update(id, updateAgentDto);
  }

  // ------------------------------ Delete ------------------------------
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent by ID' })
  @ApiResponse({
    status: 204,
    description: 'The agent has been successfully deleted.',
  })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.agentService.delete(id);
  }

  // ================================
  // AI Chat (full response)
  // ================================
  @Post(':id/chat')
  @ApiOperation({ summary: 'Send a user message to the AI and get a full response' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', example: 'web:user:123', description: 'Optional conversation/thread id' },
        message: { type: 'string', example: 'Write a 2-line mission statement', minLength: 1 },
        temperature: { type: 'number', minimum: 0, maximum: 2, example: 0.3 },
        maxTokens: { type: 'integer', minimum: 1, example: 512 },
        historyLimit: { type: 'integer', minimum: 1, maximum: 50, example: 10 },
        systemPromptOverride: { type: 'string', example: 'You are a concise assistant.' },
        persist: { type: 'boolean', example: true },
      },
      required: ['message'],
    },
  })
  @ApiCreatedResponse({
    description: 'AI response returned and (optionally) stored in Conversation.',
    schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
    },
  })
  async chat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequestDto,
  ): Promise<{ text: string }> {
    const { threadId, message, ...opts } = body;
    return this.agentService.chat(id, threadId, message, opts);
  }

  // ================================
  // AI Chat (Server-Sent Events stream)
  // ================================
  @Sse(':id/chat/stream')
  @ApiOperation({ summary: 'Stream AI response tokens via Server-Sent Events' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'SSE stream emits chunks as `data: <string>` events.',
    content: {
      'text/event-stream': {
        schema: { type: 'string', example: 'data: Hello wor\n\ndata: ld!\n\n' },
      },
    },
  })
  // Document query params for GET
  @ApiQuery({ name: 'threadId', required: false, example: 'web:user:123' })
  @ApiQuery({ name: 'message', required: true, example: 'Give me 3 short taglines.' })
  @ApiQuery({ name: 'temperature', required: false, example: 0.3 })
  @ApiQuery({ name: 'maxTokens', required: false, example: 256 })
  @ApiQuery({ name: 'historyLimit', required: false, example: 10 })
  @ApiQuery({ name: 'systemPromptOverride', required: false, example: 'You are witty.' })
  @ApiQuery({ name: 'persist', required: false, example: true })
  stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(chatStreamQuerySchema)) query: ChatStreamQueryDto,
  ): Observable<MessageEvent> {
    const { threadId, message, ...opts } = query;
    const stream = this.agentService.chatStream(id, threadId, message, opts);
    // Nest SSE expects { data: any } objects
    return from(stream).pipe(map((chunk) => ({ data: chunk } as MessageEvent)));
  }

  // ================================
  // Clear a thread (utility)
  // ================================
  @Delete(':id/thread')
  @ApiOperation({ summary: 'Clear a conversation thread for an agent' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          example: 'web:user:123',
          description: 'Thread id to clear',
        },
      },
      required: ['threadId'],
    },
  })
  @ApiOkResponse({
    description: 'Deleted messages count returned.',
    schema: {
      type: 'object',
      properties: { deleted: { type: 'number' } },
    },
  })
  async clearThread(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(clearThreadSchema)) body: ClearThreadDto,
  ): Promise<{ deleted: number }> {
    return this.agentService.clearThread(id, body.threadId);
  }
}




