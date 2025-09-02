// ===================================================
// src/agent/schemas/agent.schema.ts
// ===================================================
import { z } from "zod";
import {
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from "@prisma/client";

// --- Cross-field rules helper (adds .superRefine → returns ZodEffects)
const withAgentRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((data, ctx) => {
    if (data.useOwnApiKey === true) {
      if (!data.userProvidedApiKey || String(data.userProvidedApiKey).trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["userProvidedApiKey"],
          message: "userProvidedApiKey is required when useOwnApiKey is true.",
        });
      }
    }

    const mt = data.modelType as AIModel | undefined;
    const ensureEmpty = (field: "openAIModel" | "geminiModel" | "claudeModel") => {
      if (data[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `This field must be empty when modelType is ${mt}.`,
        });
      }
    };

    if (mt === AIModel.CHATGPT) {
      if (!data.openAIModel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["openAIModel"],
          message: "openAIModel is required when modelType is CHATGPT.",
        });
      }
      ensureEmpty("geminiModel");
      ensureEmpty("claudeModel");
    } else if (mt === AIModel.GEMINI) {
      if (!data.geminiModel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["geminiModel"],
          message: "geminiModel is required when modelType is GEMINI.",
        });
      }
      ensureEmpty("openAIModel");
      ensureEmpty("claudeModel");
    } else if (mt === AIModel.CLAUDE) {
      if (!data.claudeModel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claudeModel"],
          message: "claudeModel is required when modelType is CLAUDE.",
        });
      }
      ensureEmpty("openAIModel");
      ensureEmpty("geminiModel");
    }
  });

// --- Define the base object FIRST (this is a ZodObject, so it has omit/partial/strict)
const baseAgentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, { message: "Name cannot be empty" }),
    prompt: z.string().optional().nullable(),

    // Keys
    apiKey: z.string().optional().nullable(),
    useOwnApiKey: z.boolean().default(false),
    userProvidedApiKey: z.string().optional().nullable(),

    // Toggles
    isActive: z.boolean().default(false),
    isLeadsActive: z.boolean().default(false),
    isEmailActive: z.boolean().default(false),
    isKnowledgebaseActive: z.boolean().default(false),
    isBookingActive: z.boolean().default(false),

    // Memory & Model
    memoryType: z.nativeEnum(MemoryType).default(MemoryType.BUFFER),
    modelType: z.nativeEnum(AIModel).default(AIModel.CHATGPT),

    // Provider-specific model picks
    openAIModel: z.nativeEnum(OpenAIModel).optional().nullable(),
    geminiModel: z.nativeEnum(GeminiModel).optional().nullable(),
    claudeModel: z.nativeEnum(ClaudeModel).optional().nullable(),

    // Ownership
    userId: z.string().uuid(),

    // Timestamps
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

// --- Final exported schemas (apply .omit/.partial BEFORE withAgentRules)
export const agentSchema = withAgentRules(baseAgentSchema);

export const createAgentSchema = withAgentRules(
  baseAgentSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
);

export const updateAgentSchema = withAgentRules(
  baseAgentSchema
    .omit({
      id: true,
      createdAt: true,
      updatedAt: true,
    })
    .partial()
);

// Types (optional)
export type Agent = z.infer<typeof agentSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
