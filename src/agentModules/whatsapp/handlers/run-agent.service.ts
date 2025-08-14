// Deps: npm i googleapis luxon @langchain/openai
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { BaseMessage } from '@langchain/core/messages';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { DynamicTool } from '@langchain/core/tools';

import { Agent, LeadItem } from '@prisma/client';
import { createDynamicDataCollectionTool } from './tools/add-lead.toll';
import { buildAppointmentTools } from './tools/appointment.tools';

interface AgentWithLeadItems extends Agent {
  leadItems: LeadItem[];
}

@Injectable()
export class RunAgentService {
  private readonly logger = new Logger(RunAgentService.name);
  private readonly LC_VERBOSE = process.env.LC_VERBOSE === '1';

  constructor(private readonly prisma: PrismaService) {}

  public async runAgent(
    userInput: string,
    chat_history: BaseMessage[],
    systemPrompt: string | null,
    agentId: string,
  ): Promise<string> {
    try {
      this.logger.log(`[runAgent] agentId=${agentId}`);

      const agentRecord = (await this.prisma.agent.findUnique({
        where: { id: agentId },
        include: { leadItems: true },
      })) as AgentWithLeadItems | null;

      if (!agentRecord) {
        this.logger.error(`[runAgent] Agent not found: ${agentId}`);
        return 'Error: Agent configuration not found.';
      }

      const llm = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4o',
        temperature: 0,
      });

      const tools: DynamicTool[] = [];

      // Lead capture tool (only for general leads, not for appointment intake)
      if (agentRecord.isLeadsActive && agentRecord.leadItems?.length > 0) {
        const fieldsForTool = agentRecord.leadItems.map((item) => ({
          ...item,
          description: item.description ?? `Collect information for ${item.name}`,
        }));

        const dataCollectionTool = createDynamicDataCollectionTool({
          fields: fieldsForTool,
          prisma: this.prisma,
          agentId,
          logger: this.logger,
        });

        tools.push(dataCollectionTool);
        this.logger.log(`[runAgent] Lead tool enabled (items=${fieldsForTool.length}).`);
      }

      // Appointment tools (gated by isBookingActive)
      if (agentRecord.isBookingActive) {
        const apptTools = await buildAppointmentTools({
          prisma: this.prisma,
          logger: this.logger,
          agentId,
        });
        if (apptTools.length) tools.push(...apptTools);
      }

      const finalSystemPrompt =
        (systemPrompt || agentRecord.prompt || 'You are a helpful assistant.') +
        `

# Booking policy
When the user wants to book an appointment:
1) First call "get_available_time" without 'day' to list available calendar dates based on approved WeeklyAvailability days; then call it again with the chosen 'day' to show time slots.
2) Before calling "book_appointment_tool", call "get_appointment_intake_fields" and ask the user for each of those fields. Use those answers as "intakeAnswers".
3) Do NOT use the generic lead tool for appointment intake.
4) Confirm the final selection (day + time) and then call "book_appointment_tool".`;

      if (tools.length > 0) {
        return await this.runAgentWithTools(userInput, chat_history, finalSystemPrompt, llm, tools);
      }
      return await this.runSimpleChat(userInput, chat_history, finalSystemPrompt, llm);
    } catch (error: any) {
      this.logger.error(`[runAgent] ${error.message}`, error.stack);
      return 'An error occurred while processing your request. Please try again later.';
    }
  }

  private async runAgentWithTools(
    input: string,
    chat_history: BaseMessage[],
    system: string,
    llm: ChatOpenAI,
    tools: DynamicTool[],
  ): Promise<string> {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', system],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      new MessagesPlaceholder('agent_scratchpad'),
    ]);

    const agent = await createOpenAIToolsAgent({ llm, tools, prompt });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
      verbose: this.LC_VERBOSE,
      returnIntermediateSteps: false,
      handleParsingErrors: true,
      maxIterations: 8,
    });

    const result = await agentExecutor.invoke({ input, chat_history });
    return (result as any).output ?? result;
  }

  private async runSimpleChat(
    input: string,
    chat_history: BaseMessage[],
    system: string,
    llm: ChatOpenAI,
  ): Promise<string> {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', system],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
    ]);
    const chain = prompt.pipe(llm);
    const result = await chain.invoke({ input, chat_history });
    return result.content.toString();
  }
}
