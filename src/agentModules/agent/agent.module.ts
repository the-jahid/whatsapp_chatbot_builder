// ===================================================
// src/agent/agent.module.ts
// ===================================================
import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],          // makes PrismaService available
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],          // so other modules can use AgentService
})
export class AgentModule {}
