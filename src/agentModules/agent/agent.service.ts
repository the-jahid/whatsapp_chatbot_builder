// ===================================================
// src/agent/agent.service.ts
// ===================================================
//
// Requires (install once):
//   npm i @langchain/openai @langchain/google-genai @langchain/anthropic @langchain/core
//
// Uses env fallbacks when agent.useOwnApiKey is false:
//   OPENAI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY
//
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Agent,
  Prisma,
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
  SenderType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

// LangChain chat providers
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

export interface PaginatedAgentsResult {
  data: Agent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type AgentSortableFields =
  | 'id'
  | 'name'
  | 'prompt'
  | 'apiKey'
  | 'isActive'
  | 'isLeadsActive'
  | 'isEmailActive'
  | 'isKnowledgebaseActive'
  | 'isBookingActive'
  | 'memoryType'
  | 'modelType'
  | 'createdAt'
  | 'updatedAt';

export interface GetAllAgentsQuery {
  page?: string;
  limit?: string;
  sortBy?: AgentSortableFields;
  sortOrder?: 'asc' | 'desc';

  // filters (string because they come from query params)
  id?: string;
  name?: string;
  prompt?: string;
  apiKey?: string;

  isActive?: string;
  isLeadsActive?: string;
  isEmailActive?: string;
  isKnowledgebaseActive?: string;
  isBookingActive?: string;

  memoryType?: MemoryType;
  modelType?: AIModel;
  openAIModel?: OpenAIModel;
  geminiModel?: GeminiModel;
  claudeModel?: ClaudeModel;
}

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  // ================
  // Public: Listing
  // ================
  async getAll(
    userId: string,
    query: GetAllAgentsQuery,
  ): Promise<PaginatedAgentsResult> {
    const {
      page = '1',
      limit = '10',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      ...filters
    } = query;

    const pageNumber = this.parsePositiveInt(page, 1);
    const limitNumber = this.parsePositiveInt(limit, 10);
    const skip = (pageNumber - 1) * limitNumber;

    const where = this.buildWhere(userId, filters);
    const orderBy = this.buildOrderBy(sortBy, sortOrder);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return {
      data,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.max(1, Math.ceil(total / limitNumber)),
    };
  }

  async getById(id: string, userId?: string): Promise<Agent> {
    const where: Prisma.AgentWhereInput = { id, ...(userId ? { userId } : {}) };
    const agent = await this.prisma.agent.findFirst({ where });
    if (!agent) throw new NotFoundException(`Agent with ID "${id}" not found.`);
    return agent;
  }

  // ================
  // Public: Mutations
  // ================
  async create(dto: CreateAgentDto): Promise<Agent> {
    await this.ensureUserExists(dto.userId);

    const data = this.normalizeProviderModels(dto);
    if (data.useOwnApiKey !== true) data.userProvidedApiKey = null;

    try {
      return await this.prisma.agent.create({
        data: data as Prisma.AgentUncheckedCreateInput,
      });
    } catch (e: any) {
      this.handlePrismaError(e, 'creating');
    }
  }

  async update(id: string, dto: UpdateAgentDto, userId?: string): Promise<Agent> {
    await this.getById(id, userId); // verifies ownership/existence

    const data = this.normalizeProviderModels(dto);
    if (data.useOwnApiKey === false) data.userProvidedApiKey = null;

    try {
      return await this.prisma.agent.update({
        where: { id },
        data: data as Prisma.AgentUncheckedUpdateInput,
      });
    } catch (e: any) {
      this.handlePrismaError(e, 'updating');
    }
  }

  async delete(id: string, userId?: string): Promise<Agent> {
    await this.getById(id, userId); // verifies ownership/existence
    return this.prisma.agent.delete({ where: { id } });
  }

  // ===========================
  // Public: AI Chat (full text)
  // ===========================
  async chat(
    agentId: string,
    threadId: string | undefined,     // pass undefined to use default
    userMessage: string,
    opts?: {
      temperature?: number;           // 0..2 (provider-dependent)
      maxTokens?: number;             // cap output tokens
      historyLimit?: number;          // number of past turns to include (BUFFER)
      systemPromptOverride?: string;  // override agent.prompt
      persist?: boolean;              // default true
    }
  ): Promise<{ text: string }> {
    const agent = await this.getById(agentId);
    const {
      temperature = 0.3,
      maxTokens,
      historyLimit = 10,
      systemPromptOverride,
      persist = true,
    } = opts ?? {};

    const sid = this.makeThreadId(threadId, agentId);
    const { provider, apiKey, model } = this.resolveModelAndKey(agent);
    const messages = await this.buildMessages({
      agent,
      threadId: sid,
      historyLimit,
      systemPromptOverride,
      userMessage,
    });

    const llm = this.makeChatModel({ provider, apiKey, model, temperature, maxTokens });

    if (persist) {
      await this.saveConversation(agentId, sid, userMessage, SenderType.HUMAN);
    }

    const aiMsg = await llm.invoke(messages);
    const text =
      typeof aiMsg?.content === 'string'
        ? aiMsg.content
        : Array.isArray(aiMsg?.content)
          ? aiMsg.content.map((b: any) => b?.text ?? '').join('')
          : '';

    if (persist) {
      await this.saveConversation(agentId, sid, text, SenderType.AI, {
        provider,
        model,
        usage: (aiMsg as any)?.usage,
      });
    }

    return { text };
  }

  // =============================================
  // Public: AI Chat Streaming (async generator)
  // =============================================
  async *chatStream(
    agentId: string,
    threadId: string | undefined,
    userMessage: string,
    opts?: {
      temperature?: number;
      maxTokens?: number;
      historyLimit?: number;
      systemPromptOverride?: string;
      persist?: boolean;
    }
  ): AsyncGenerator<string> {
    const agent = await this.getById(agentId);
    const {
      temperature = 0.3,
      maxTokens,
      historyLimit = 10,
      systemPromptOverride,
      persist = true,
    } = opts ?? {};

    const sid = this.makeThreadId(threadId, agentId);
    const { provider, apiKey, model } = this.resolveModelAndKey(agent);
    const messages = await this.buildMessages({
      agent,
      threadId: sid,
      historyLimit,
      systemPromptOverride,
      userMessage,
    });

    const llm = this.makeChatModel({ provider, apiKey, model, temperature, maxTokens });

    if (persist) {
      await this.saveConversation(agentId, sid, userMessage, SenderType.HUMAN);
    }

    let full = '';
    for await (const chunk of (llm as any).stream(messages)) {
      const piece =
        typeof (chunk as any)?.content === 'string'
          ? (chunk as any).content
          : Array.isArray((chunk as any)?.content)
            ? (chunk as any).content.map((b: any) => b?.text ?? '').join('')
            : '';
      if (piece) {
        full += piece;
        yield piece;
      }
    }

    if (persist) {
      await this.saveConversation(agentId, sid, full, SenderType.AI, { provider, model });
    }
  }

  // ===========================
  // Public: Utility (optional)
  // ===========================
  async clearThread(agentId: string, threadId?: string): Promise<{ deleted: number }> {
    const sid = this.makeThreadId(threadId, agentId);
    const res = await this.prisma.conversation.deleteMany({
      where: { agentId, senderJid: sid },
    });
    return { deleted: res.count };
  }

  // ---------------
  // Helper methods
  // ---------------
  private buildWhere(
    userId: string,
    filters: Omit<GetAllAgentsQuery, 'page' | 'limit' | 'sortBy' | 'sortOrder'>,
  ): Prisma.AgentWhereInput {
    const where: Prisma.AgentWhereInput = { userId };

    const setBool = (key: keyof Prisma.AgentWhereInput, v?: string) => {
      if (typeof v === 'string') (where as any)[key] = v.toLowerCase() === 'true';
    };

    const setContains = (key: keyof Prisma.AgentWhereInput, v?: string) => {
      if (v && typeof v === 'string') {
        (where as any)[key] = { contains: v, mode: 'insensitive' };
      }
    };

    // text-ish filters
    setContains('id', filters.id);
    setContains('name', filters.name);
    setContains('prompt', filters.prompt);
    setContains('apiKey', filters.apiKey);

    // booleans
    setBool('isActive', filters.isActive);
    setBool('isLeadsActive', filters.isLeadsActive);
    setBool('isEmailActive', filters.isEmailActive);
    setBool('isKnowledgebaseActive', filters.isKnowledgebaseActive);
    setBool('isBookingActive', filters.isBookingActive);

    // enums
    if (filters.memoryType) where.memoryType = filters.memoryType;
    if (filters.modelType) where.modelType = filters.modelType;
    if (filters.openAIModel) where.openAIModel = filters.openAIModel;
    if (filters.geminiModel) where.geminiModel = filters.geminiModel;
    if (filters.claudeModel) where.claudeModel = filters.claudeModel;

    return where;
  }

  private buildOrderBy(
    sortBy: AgentSortableFields,
    sortOrder: 'asc' | 'desc',
  ): Prisma.AgentOrderByWithRelationInput {
    const allowed: AgentSortableFields[] = [
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
    ];
    const safeField: AgentSortableFields = allowed.includes(sortBy)
      ? sortBy
      : 'createdAt';
    const safeOrder: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';
    return { [safeField]: safeOrder };
  }

  private parsePositiveInt(input: string, fallback: number): number {
    const n = parseInt(input, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(
        `User with ID "${userId}" not found. Cannot create agent.`,
      );
    }
  }

  /** Ensure only the selected provider model is kept, others nulled */
  private normalizeProviderModels<
    T extends Partial<
      Pick<
        CreateAgentDto & UpdateAgentDto,
        'modelType' | 'openAIModel' | 'geminiModel' | 'claudeModel'
      >
    > & Record<string, any>
  >(dto: T): T {
    const data = { ...dto };

    switch (data.modelType) {
      case AIModel.CHATGPT:
        data.geminiModel = null as any;
        data.claudeModel = null as any;
        break;
      case AIModel.GEMINI:
        data.openAIModel = null as any;
        data.claudeModel = null as any;
        break;
      case AIModel.CLAUDE:
        data.openAIModel = null as any;
        data.geminiModel = null as any;
        break;
      default:
        break;
    }
    return data;
  }

  // --------- AI helpers ---------

  /** Ensure we always have a non-empty string for Conversation.senderJid */
  private makeThreadId(threadId: string | undefined, agentId: string): string {
    return threadId && threadId.trim() ? threadId.trim() : `global:${agentId}`;
  }

  /** Build prompt + history (BUFFER or NONE) */
  private async buildMessages(args: {
    agent: Agent;
    threadId: string;
    historyLimit: number;
    systemPromptOverride?: string;
    userMessage: string;
  }) {
    const { agent, threadId, historyLimit, systemPromptOverride, userMessage } = args;
    const msgs: any[] = [];

    const sys = (systemPromptOverride ?? agent.prompt)?.trim();
    if (sys) msgs.push(new SystemMessage(sys));

    if (agent.memoryType === MemoryType.BUFFER) {
      const history = await this.prisma.conversation.findMany({
        where: { agentId: agent.id, senderJid: threadId },
        orderBy: { createdAt: 'desc' },
        take: historyLimit * 2, // approx. H+AI per turn
      });
      history.reverse().forEach((m) => {
        if (!m.message) return;
        if (m.senderType === 'HUMAN') msgs.push(new HumanMessage(m.message));
        else msgs.push(new AIMessage(m.message));
      });
    }
    // MemoryType.NONE → no past messages

    msgs.push(new HumanMessage(userMessage));
    return msgs;
  }

  /** Persist a conversation line */
  private async saveConversation(
    agentId: string,
    threadId: string,
    message: string,
    senderType: SenderType,
    metadata?: Record<string, any>
  ) {
    await this.prisma.conversation.create({
      data: {
        agentId,
        senderJid: threadId,
        message,
        senderType,
        metadata: metadata ?? undefined,
      },
    });
  }

  /** Create a provider-specific chat model */
  private makeChatModel(args: {
    provider: 'openai' | 'gemini' | 'anthropic';
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    const { provider, apiKey, model, temperature, maxTokens } = args;

    if (provider === 'openai') {
      return new ChatOpenAI({ apiKey, model, temperature, maxTokens });
    }
    if (provider === 'gemini') {
      // LangChain maps to maxOutputTokens under the hood
      return new ChatGoogleGenerativeAI({
        apiKey,
        model,
        temperature,
        maxOutputTokens: maxTokens,
      });
    }
    return new ChatAnthropic({ apiKey, model, temperature, maxTokens });
  }

  /** Resolve provider + API key + concrete model name */
  private resolveModelAndKey(agent: Agent): {
    provider: 'openai' | 'gemini' | 'anthropic';
    apiKey: string;
    model: string;
  } {
    switch (agent.modelType) {
      case AIModel.CHATGPT: {
        const apiKey = agent.useOwnApiKey
          ? (agent.userProvidedApiKey || '')
          : (process.env.OPENAI_API_KEY || '');
        if (!apiKey) throw new BadRequestException('Missing OpenAI API key.');
        const model = this.mapOpenAIModel(agent.openAIModel);
        return { provider: 'openai', apiKey, model };
      }
      case AIModel.GEMINI: {
        const apiKey = agent.useOwnApiKey
          ? (agent.userProvidedApiKey || '')
          : (process.env.GOOGLE_API_KEY || '');
        if (!apiKey) throw new BadRequestException('Missing Google Gemini API key.');
        const model = this.mapGeminiModel(agent.geminiModel);
        return { provider: 'gemini', apiKey, model };
      }
      case AIModel.CLAUDE: {
        const apiKey = agent.useOwnApiKey
          ? (agent.userProvidedApiKey || '')
          : (process.env.ANTHROPIC_API_KEY || '');
        if (!apiKey) throw new BadRequestException('Missing Anthropic API key.');
        const model = this.mapClaudeModel(agent.claudeModel);
        return { provider: 'anthropic', apiKey, model };
      }
      default:
        throw new BadRequestException('Unsupported modelType on agent.');
    }
  }

  // --- Model mappers with sane fallbacks for your enums ---
  private mapOpenAIModel(m?: OpenAIModel | null): string {
    const map: Partial<Record<OpenAIModel, string>> = {
      gpt_4: 'gpt-4o',
      gpt_4_1: 'gpt-4.1',
      gpt_4_1_mini: 'gpt-4.1-mini',
      gpt_4_turbo: 'gpt-4o',
      gpt_4_turbo_16k: 'gpt-4o',
      gpt_4_turbo_32k: 'gpt-4o',
      gpt_4_vision: 'gpt-4o-mini',
      gpt_4_vision_16k: 'gpt-4o-mini',
      gpt_5: 'gpt-4.1',
      gpt_5_mini: 'gpt-4.1-mini',
      gpt_5_nano: 'gpt-4o-mini',
      gpt_5_thinking: 'gpt-4.1',
      gpt_5_thinking_mini: 'gpt-4.1-mini',
      gpt_5_thinking_nano: 'gpt-4o-mini',
      gpt_5_thinking_pro: 'gpt-4.1',
      gpt_5_turbo: 'gpt-4.1',
      gpt_5_turbo_16k: 'gpt-4.1',
      gpt_5_turbo_32k: 'gpt-4.1',
      gpt_5_vision: 'gpt-4o-mini',
      gpt_4_1_nano: 'gpt-4o-mini',
    };
    return (m && map[m]) || 'gpt-4o-mini';
  }

  private mapGeminiModel(m?: GeminiModel | null): string {
    const map: Partial<Record<GeminiModel, string>> = {
      gemini_2_5_pro: 'gemini-2.5-pro',
      gemini_2_5_flash: 'gemini-2.5-flash',
      gemini_2_5_flash_lite: 'gemini-2.5-flash-lite',
      gemini_2_0_flash: 'gemini-2.0-flash',
      gemini_2_0_flash_lite: 'gemini-2.0-flash-lite',
      gemini_2_0_flash_preview_image_generation: 'gemini-2.0-flash',
      gemini_2_0_flash_live_001: 'gemini-2.0-flash',
      gemini_1_5_pro: 'gemini-1.5-pro',
      gemini_1_5_flash: 'gemini-1.5-flash',
      gemini_1_0_pro: 'gemini-1.5-pro',
      gemini_1_0_ultra: 'gemini-1.5-pro',
      gemini_1_0_nano_1: 'gemini-1.5-flash',
      gemini_1_0_nano_2: 'gemini-1.5-flash',
    };
    return (m && map[m]) || 'gemini-1.5-pro';
  }

  private mapClaudeModel(m?: ClaudeModel | null): string {
    const map: Partial<Record<ClaudeModel, string>> = {
      claude_3_5_sonnet: 'claude-3.5-sonnet-20241022',
      claude_3_5_sonnet_v2: 'claude-3.5-sonnet-20241022',
      claude_3_5_haiku: 'claude-3.5-haiku-20241022',
      claude_3_sonnet: 'claude-3-sonnet-20240229',
      claude_3_haiku: 'claude-3-haiku-20240307',
      claude_3_opus: 'claude-3-opus-20240229',
      claude_3_7_sonnet: 'claude-3-5-sonnet-latest',
      claude_4_opus: 'claude-3-opus-20240229',
      claude_4_opus_4_1: 'claude-3-opus-20240229',
      claude_4_sonnet: 'claude-3.5-sonnet-20241022',
    };
    return (m && map[m]) || 'claude-3-5-sonnet-latest';
  }

  private handlePrismaError(e: any, action: string): never {
    if (e?.code === 'P2002') {
      const fields = e.meta?.target ?? [];
      throw new BadRequestException(
        `Unique constraint failed while ${action} agent${fields.length ? ` on fields: ${fields.join(', ')}` : ''}.`,
      );
    }
    throw e;
  }
}
