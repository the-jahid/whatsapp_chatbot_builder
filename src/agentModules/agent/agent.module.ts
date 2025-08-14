import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';


@Module({
  // Import PrismaModule to make PrismaService available
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}









