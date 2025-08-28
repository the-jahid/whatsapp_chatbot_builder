import type { Prisma, OutboundCampaignStatus, OutboundCampaignType } from '@prisma/client';

export interface IOutboundCampaign {
  id: string;
  name: string;

  type: OutboundCampaignType;
  status: OutboundCampaignStatus;

  agentEnabled: boolean;

  // lifecycle
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;

  // ownership
  agentId: string;

  // template assignment (nullable)
  assignedTemplate: string | null;

  // dashboard counters
  totalMessages: number;
  leadsCount: number;
  answeredLeadsCount: number;
  lastActivityAt: Date | null;

  // flexible blobs
  config: Prisma.JsonValue | null;
  stats: Prisma.JsonValue | null;

  // bookkeeping
  createdAt: Date;
  updatedAt: Date;
}
