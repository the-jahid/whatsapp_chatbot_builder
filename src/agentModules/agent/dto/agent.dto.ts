// ===================================================
// 2. DTO: src/agent/dto/agent.dto.ts
// ===================================================
import { z } from 'zod';
import { createAgentSchema, updateAgentSchema } from '../schemas/agent.schema';

// The DTO for creating an agent, inferred from the updated create schema.
export type CreateAgentDto = z.infer<typeof createAgentSchema>;

// The DTO for updating an agent, inferred from the updated schema.
export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;