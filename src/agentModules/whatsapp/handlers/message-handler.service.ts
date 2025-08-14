import { Injectable, Logger } from '@nestjs/common';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { PrismaService } from 'src/prisma/prisma.service';
import { Agent, MemoryType } from '@prisma/client';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ConversationService } from 'src/agentModules/conversation/conversation.service';
import { RunAgentService } from './run-agent.service';


@Injectable()
export class MessageHandlerService {
  private readonly logger = new Logger(MessageHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly agentService: RunAgentService, // <-- INJECT the new service
  ) {}

  /**
   * Main handler for incoming WhatsApp messages.
   * Orchestrates the process of receiving, processing, and responding to a message.
   */
  public async handleMessage(
    socket: WASocket,
    msg: WAMessage,
    agentId: string,
  ): Promise<void> {
    const senderJid = msg.key.remoteJid;

    // 1. Validate incoming message
    if (!msg.message || msg.key.fromMe || !senderJid) {
      return;
    }
    
    const incomingMessageText =
      msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!incomingMessageText) {
      this.logger.warn('Received a message without text content.');
      return;
    }

    // 2. Validate agent
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || !agent.isActive) {
      this.logger.log(`Agent ${agentId} not found or is inactive.`);
      return;
    }

    this.logger.log(
      `Processing message from ${senderJid} for agent ${agentId}: "${incomingMessageText}"`,
    );

    try {
      // 3. Save incoming message to DB
      await this.conversationService.create({
        agentId: agent.id,
        senderJid,
        message: incomingMessageText,
        senderType: 'HUMAN',
      });

      // 4. Perform actions: get history, run agent, send response
      await this._sendTypingIndicator(socket, senderJid);
      const chatHistory = await this._getHistory(agent.id, senderJid, agent.memoryType);
      
      // Use the injected AgentService
      const aiResponse = await this.agentService.runAgent(
        incomingMessageText,
        chatHistory,
        agent.prompt,
        agentId
      );

      // 5. Save AI response to DB
      await this.conversationService.create({
        agentId: agent.id,
        senderJid,
        message: aiResponse,
        senderType: 'AI',
      });

      // 6. Send the final response to the user
      await this._sendResponse(socket, senderJid, aiResponse);

    } catch (error: any) {
      this.logger.error(
        `Failed to handle message for ${senderJid}: ${error.message}`,
        error.stack,
      );
      await this._sendResponse(socket, senderJid, 'Sorry, I encountered an error. Please try again later.');
    }
  }

  // --- Private Helper Methods ---

  /**
   * Fetches and formats the conversation history from the database.
   */
  private async _getHistory(
    agentId: string,
    senderJid: string,
    memoryType: MemoryType,
  ): Promise<BaseMessage[]> {
    if (memoryType !== MemoryType.BUFFER) {
      return [];
    }
    const recentHistory = await this.prisma.conversation.findMany({
      where: { agentId, senderJid },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return recentHistory
      .reverse()
      .map((h) =>
        h.senderType === 'HUMAN'
          ? new HumanMessage(h.message)
          : new AIMessage(h.message),
      );
  }

  /**
   * Sends the 'composing' presence update to WhatsApp.
   */
  private async _sendTypingIndicator(socket: WASocket, jid: string): Promise<void> {
    try {
      await socket.presenceSubscribe(jid);
      await socket.sendPresenceUpdate('composing', jid);
    } catch (error) {
      this.logger.warn(`Could not send typing indicator to ${jid}`, error);
    }
  }

  /**
   * Sends a final text message response to WhatsApp.
   */
  private async _sendResponse(socket: WASocket, jid: string, text: string): Promise<void> {
    try {
      await socket.sendPresenceUpdate('paused', jid);
      await socket.sendMessage(jid, { text });
      this.logger.log(`Sent AI reply to ${jid}: "${text}"`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${jid}`, error);
    }
  }
}
