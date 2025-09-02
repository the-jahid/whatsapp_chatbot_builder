// ===================================================
// src/agent/dto/agent.dto.ts
// ===================================================
import { z } from "zod";
import {
  agentSchema,
  createAgentSchema,
  updateAgentSchema,
} from "../schemas/agent.schema";
import { Injectable, BadRequestException, PipeTransform } from "@nestjs/common";

/** ---------- Types inferred from Zod ---------- */
export type AgentDto = z.infer<typeof agentSchema>;
export type CreateAgentDto = z.infer<typeof createAgentSchema>;
export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;

/** ---------- Parse helpers (use anywhere, e.g. services/tests) ---------- */
export const parseCreateAgentDto = (data: unknown): CreateAgentDto =>
  createAgentSchema.parse(data);

export const parseUpdateAgentDto = (data: unknown): UpdateAgentDto =>
  updateAgentSchema.parse(data);

/** ---------- Generic Zod pipe + concrete pipes ---------- */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodTypeAny) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Send a clean, useful error payload
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}

@Injectable()
export class CreateAgentPipe extends ZodValidationPipe {
  constructor() {
    super(createAgentSchema);
  }
}

@Injectable()
export class UpdateAgentPipe extends ZodValidationPipe {
  constructor() {
    super(updateAgentSchema);
  }
}
