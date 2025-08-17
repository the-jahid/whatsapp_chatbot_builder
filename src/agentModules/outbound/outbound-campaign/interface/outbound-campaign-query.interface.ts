import type { OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

export type OutboundCampaignSortBy =
  | 'createdAt'
  | 'scheduledAt'
  | 'lastActivityAt'
  | 'name'
  | 'status';

export type SortOrder = 'asc' | 'desc';

/**
 * Mirrors QueryOutboundCampaignsSchema (IDs are strings; UUID version is not enforced here).
 */
export interface IOutboundCampaignQuery {
  page?: number;          // default 1
  limit?: number;         // default 20 (max 100)

  agentId?: string;
  type?: OutboundCampaignType;
  status?: OutboundCampaignStatus | OutboundCampaignStatus[];

  q?: string;             // search by name

  scheduledFrom?: Date | string;
  scheduledTo?: Date | string;
  createdFrom?: Date | string;
  createdTo?: Date | string;

  sortBy?: OutboundCampaignSortBy;  // default 'createdAt'
  sortOrder?: SortOrder;            // default 'desc'
}
