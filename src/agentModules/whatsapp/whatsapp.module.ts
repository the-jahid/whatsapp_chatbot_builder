// src/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MessageHandlerService } from './handlers/message-handler.service';
import { AgentModule } from '../agent/agent.module';
// import { ConversationModule } from '../conversation/conversation.module'; // no longer needed for this handler


@Module({
  imports: [AgentModule], // ConversationModule not required for this path
  controllers: [WhatsappController],
  providers: [WhatsappService, MessageHandlerService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
