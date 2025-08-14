// ===================================================
// 1. Zod Schema: src/agent/schemas/agent.schema.ts
// ===================================================
import { z } from 'zod';
import { MemoryType } from '@prisma/client'; // Import the MemoryType enum

// Base schema defining the core Agent structure.
// It now uses `memoryType` instead of the old boolean flags.
export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, { message: "Name cannot be empty" }),
  prompt: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  isActive: z.boolean().default(false),
  // UPDATED: Replaced boolean flags with a single memory type selection.
  memoryType: z.nativeEnum(MemoryType).default(MemoryType.BUFFER),
  isLeadsActive: z.boolean().default(false),
  isEmailActive: z.boolean().default(false),
  userId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Schema for creating a new agent.
export const createAgentSchema = agentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Schema for updating an existing agent.
export const updateAgentSchema = createAgentSchema.partial().strict();