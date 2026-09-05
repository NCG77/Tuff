export type DashboardTab = "all" | "cost" | "security" | "logs" | "alerts" | "help";

export interface Finding {
  /**
   * Unique key for this finding. One AWS resource can raise several findings
   * (an under-used instance is both idle and a rightsizing candidate), so the
   * resource id alone is not enough to track approve/dismiss state.
   */
  uid: string;
  /** The AWS resource id, used for display and for remediation calls. */
  id: string;
  type: string;
  inst: string;
  region: string;
  cur: string;
  save: string;
  cpu: string;
  severity?: string;
  explanation?: string;
  business_impact?: string;
  recommended_action?: string;
  priority?: string;
  requires_upgrade?: boolean;
  metrics?: {
    suggested_type?: string;
    instance_type?: string;
    [key: string]: unknown;
  };
}

export interface AlertConfig {
  id: string;
  resourceType: string;
  metric: string;
  threshold: number;
  thresholdType: string;
  created_at?: string;
}

export interface TriggeredAlert {
  id: string | number;
  configId: string;
  resourceId: string;
  resourceType: string;
  metric: string;
  value: number;
  threshold: number;
  condition: string;
  timestamp: string;
}

export interface ActionRecord {
  id: string;
  resourceId: string;
  action: string;
  type: string;
  timestamp: string;
}
