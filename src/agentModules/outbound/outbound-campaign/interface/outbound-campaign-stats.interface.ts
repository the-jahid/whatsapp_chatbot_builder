export interface IOutboundCampaignStats {
  totalMessages: number;
  leadsCount: number;
  answeredLeadsCount: number;

  // Derived
  unansweredLeadsCount: number;  // leadsCount - answeredLeadsCount (>= 0)
  leadAnswerRate: number;        // 0..1
  lastActivityAt: Date | null;
}
