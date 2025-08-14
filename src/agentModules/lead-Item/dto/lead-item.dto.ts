// src/lead-item/dto/lead-item.dto.ts

import { z } from 'zod';
import { createLeadItemSchema, updateLeadItemSchema } from '../schema/lead-item.schema';

/**
 * The DTO type for creating a new LeadItem.
 * Inferred from the Zod schema for perfect type safety.
 */
export type CreateLeadItemDto = z.infer<typeof createLeadItemSchema>;

/**
 * The DTO type for updating an existing LeadItem.
 * Inferred from the Zod schema, making all properties optional.
 */
export type UpdateLeadItemDto = z.infer<typeof updateLeadItemSchema>;
