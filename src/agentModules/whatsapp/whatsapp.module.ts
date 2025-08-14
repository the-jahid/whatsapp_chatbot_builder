import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MessageHandlerService } from './handlers/message-handler.service';
import { ConversationModule } from '../conversation/conversation.module';
import { RunAgentService } from './handlers/run-agent.service';


@Module({
  // FIX: Import the ConversationModule here.
  // This makes any exported providers from ConversationModule,
  // like ConversationService, available for injection within this module.
  imports: [ConversationModule],

  controllers: [WhatsappController],
  providers: [WhatsappService, MessageHandlerService, RunAgentService],
})
export class WhatsappModule {}

