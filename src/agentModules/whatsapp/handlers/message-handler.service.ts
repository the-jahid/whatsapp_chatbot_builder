// src/whatsapp/handlers/message-handler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { AgentService } from 'src/agentModules/agent/agent.service';


@Injectable()
export class MessageHandlerService {
  private readonly logger = new Logger(MessageHandlerService.name);

  constructor(private readonly agentService: AgentService) {}

  /**
   * Main handler for incoming WhatsApp messages.
   * Uses AgentService.chat to generate + persist AI replies.
   */
  public async handleMessage(
    socket: WASocket,
    msg: WAMessage,
    agentId: string,
  ): Promise<void> {
    const senderJid = msg.key.remoteJid;

    // 1) Validate incoming message
    if (!msg.message || msg.key.fromMe || !senderJid) return;

    // pull the best-guess text from the WA payload
    const incomingMessageText =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption;

    if (!incomingMessageText) {
      this.logger.warn('Received a message without text content.');
      return;
    }

    // 2) Validate agent (exists + active)
    const agent = await this.agentService.getById(agentId);
    if (!agent || !agent.isActive) {
      this.logger.log(`Agent ${agentId} not found or inactive.`);
      return;
    }

    this.logger.log(
      `Processing from ${senderJid} for agent ${agentId}: "${incomingMessageText}"`,
    );

    try {
      // 3) UX: typing indicator
      await this._sendTypingIndicator(socket, senderJid);

      // 4) AI chat (this will also persist HUMAN + AI turns to Conversation)
      //    - threadId = senderJid
      //    - history included automatically if agent.memoryType === BUFFER
      const { text } = await this.agentService.chat(
        agentId,
        senderJid,               // <- threadId
        incomingMessageText,
        {
          temperature: 0.3,
          historyLimit: 10,
          // systemPromptOverride: 'Optional system override...',
          persist: true,         // persist both HUMAN and AI messages
        },
      );

      // 5) Send the response back to the user
      await this._sendResponse(socket, senderJid, text);
    } catch (error: any) {
      this.logger.error(
        `Failed to handle message for ${senderJid}: ${error?.message}`,
        error?.stack,
      );
      await this._sendResponse(
        socket,
        senderJid,
        'Sorry, I encountered an error. Please try again later.',
      );
    } finally {
      // optional: pause presence
      try {
        await socket.sendPresenceUpdate('paused', senderJid);
      } catch {}
    }
  }

  // --- Private Helper Methods ---

  private async _sendTypingIndicator(socket: WASocket, jid: string): Promise<void> {
    try {
      await socket.presenceSubscribe(jid);
      await socket.sendPresenceUpdate('composing', jid);
    } catch (error) {
      this.logger.warn(`Could not send typing indicator to ${jid}`, error);
    }
  }

  private async _sendResponse(socket: WASocket, jid: string, text: string): Promise<void> {
    try {
      await socket.sendMessage(jid, { text });
      this.logger.log(`Sent AI reply to ${jid}: "${text}"`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${jid}`, error);
    }
  }
}
