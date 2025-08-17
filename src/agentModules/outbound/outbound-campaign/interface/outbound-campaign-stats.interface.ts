export interface IOutboundCampaignStats {
  totalMessages?: number;
  leadsCount?: number;
  answeredLeadsCount?: number;

  // Derived
  unansweredLeadsCount?: number;  // leadsCount - answeredLeadsCount
  leadAnswerRate?: number;        // 0..1
  lastActivityAt?: Date | null;
}
