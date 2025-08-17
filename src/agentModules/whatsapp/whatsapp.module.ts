// src/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MessageHandlerService } from './handlers/message-handler.service';
import { ConversationModule } from '../conversation/conversation.module';
import { RunAgentService } from './handlers/run-agent.service';

@Module({
  imports: [ConversationModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, MessageHandlerService, RunAgentService],
  exports: [WhatsappService],              // 👈 export so other modules can inject it
})
export class WhatsappModule {}
