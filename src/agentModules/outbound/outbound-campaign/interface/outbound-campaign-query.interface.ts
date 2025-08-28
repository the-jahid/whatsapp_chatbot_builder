import type { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

export type OutboundCampaignSortBy =
  | 'createdAt'
  | 'scheduledAt'
  | 'lastActivityAt'
  | 'name'
  | 'status';

export type SortOrder = 'asc' | 'desc';

/**
 * Normalized query shape AFTER Zod validation (QueryOutboundCampaignsSchema).
 * - Defaults applied: page, limit, sortBy, sortOrder
 * - Dates coerced to Date
 * - status normalized to an array
 */
export interface IOutboundCampaignQuery {
  page: number;                        // defaulted by schema (1)
  limit: number;                       // defaulted by schema (20)

  agentId?: string;
  type?: OutboundCampaignType;
  status?: OutboundCampaignStatus[];   // normalized (single -> array)

  q?: string;                          // empty trimmed to undefined by schema

  scheduledFrom?: Date;
  scheduledTo?: Date;
  createdFrom?: Date;
  createdTo?: Date;

  sortBy: OutboundCampaignSortBy;      // defaulted by schema ('createdAt')
  sortOrder: SortOrder;                // defaulted by schema ('desc')
}
