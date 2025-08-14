// src/lead-item/interface/lead-item.interface.ts

/**
 * Defines the TypeScript interface for a LeadItem object,
 * ensuring type safety across the application.
 */
export interface ILeadItem {
  id: string;
  name: string;
  description?: string | null;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}
