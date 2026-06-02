import styles from "@/app/src/main_page/page.module.css";

interface StatsPanelProps {
  findings: any[];
  dismissed: Set<string>;
  totalSavings: number;
  approved: Set<string>;
  alertConfigs: any[];
  triggeredAlerts: any[];
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
  const filteredFindings = findings.filter((f) => !dismissed.has(f.id));

  return (
    <div className={styles.statsGrid}>
      <div className={styles.card}>
        <p className={styles.statLabel}>Active Resources</p>
        <h2 className={styles.statValue}>{findings.length}</h2>
        <span className={styles.positive}>
          {filteredFindings.length} requiring action
        </span>
      </div>

      <div className={styles.card}>
        <p className={styles.statLabel}>Total Potential Savings</p>
        <h2 className={styles.statValue}>
          ${(totalSavings / 1000).toFixed(1)}K
        </h2>
        <span className={styles.positive}>▲ Monthly</span>
      </div>

      <div className={styles.card}>
        <p className={styles.statLabel}>Approved</p>
        <h2 className={styles.statValue}>{approved.size}</h2>
        <span>Actions processed</span>
      </div>

      <button
        className={styles.card}
        onClick={onAlertTabClick}
        style={{
          cursor: "pointer",
          background:
            "linear-gradient(135deg, rgba(100, 140, 80, 0.12), rgba(100, 140, 80, 0.06))",
          border: "1px solid rgba(100, 140, 80, 0.3)",
        }}
      >
        <p className={styles.statLabel}>Alerts</p>
        <h2 className={styles.statValue}>{alertConfigs.length}</h2>
        <span className={styles.positive}>
          {triggeredAlerts.length} triggered
        </span>
      </button>
    </div>
  );
}
