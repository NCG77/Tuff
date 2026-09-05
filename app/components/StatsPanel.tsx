import styles from "@/app/src/main_page/page.module.css";
import { formatCurrency } from "@/app/lib/format";
import type { AlertConfig, Finding, TriggeredAlert } from "@/app/lib/types";

interface StatsPanelProps {
  findings: Finding[];
  dismissed: Set<string>;
  totalSavings: number;
  approved: Set<string>;
  alertConfigs: AlertConfig[];
  triggeredAlerts: TriggeredAlert[];
  onAlertTabClick: () => void;
}

export default function StatsPanel({
  findings,
  dismissed,
  totalSavings,
  approved,
  alertConfigs,
  triggeredAlerts,
  onAlertTabClick,
}: StatsPanelProps) {
  const openFindings = findings.filter((f) => !dismissed.has(f.uid));
  const criticalCount = openFindings.filter(
    (f) => f.severity === "critical" || f.priority === "high",
  ).length;

  return (
    <div className={styles.statsGrid}>
      <div className={styles.card}>
        <p className={styles.statLabel}>Open Findings</p>
        <h2 className={styles.statValue}>{openFindings.length}</h2>
        <span className={styles.positive}>
          {criticalCount > 0 ? `${criticalCount} high priority` : "none high priority"}
        </span>
      </div>

      <div className={styles.card}>
        <p className={styles.statLabel}>Total Potential Savings</p>
        {/* Formatted adaptively: the previous fixed "/1000 + K" rendered $450
            as "$0.5K" and $40 as "$0.0K", which read as no savings at all. */}
        <h2 className={styles.statValue}>{formatCurrency(totalSavings)}</h2>
        <span className={styles.positive}>per month, estimated</span>
      </div>

      <div className={styles.card}>
        <p className={styles.statLabel}>Actions Approved</p>
        <h2 className={styles.statValue}>{approved.size}</h2>
        <span>this session</span>
      </div>

      <button
        className={styles.card}
        onClick={onAlertTabClick}
        style={{
          cursor: "pointer",
          textAlign: "left",
          background:
            "linear-gradient(135deg, rgba(100, 140, 80, 0.12), rgba(100, 140, 80, 0.06))",
          border: "1px solid rgba(100, 140, 80, 0.3)",
        }}
      >
        <p className={styles.statLabel}>Alerts</p>
        <h2 className={styles.statValue}>{alertConfigs.length}</h2>
        <span className={styles.positive}>{triggeredAlerts.length} triggered</span>
      </button>
    </div>
  );
}
