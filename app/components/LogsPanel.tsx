import styles from "@/app/src/main_page/page.module.css";

interface ActionRecord {
  id: string;
  resourceId: string;
  action: string;
  type: string;
  timestamp: string;
}

interface LogsPanelProps {
  actionHistory: ActionRecord[];
}

export default function LogsPanel({ actionHistory }: LogsPanelProps) {
  return (
    <div className={`${styles.largeCard} ${styles.logsCard}`}>
      <div className={styles.cardHeader}>
        <h3>Action History</h3>
      </div>

      {actionHistory.length === 0 ? (
        <div className={styles.emptyState}>
          No actions recorded yet. Approve or dismiss resources to see history.
        </div>
      ) : (
        <>
          <div className={styles.logsHeader}>
            <span className={styles.logCol}>Timestamp</span>
            <span className={styles.logCol}>Resource ID</span>
            <span className={styles.logCol}>Type</span>
            <span className={styles.logCol}>Action</span>
          </div>
          <div className={styles.logsContainer}>
            {[...actionHistory].reverse().map((record) => (
              <div key={record.id} className={styles.logRow}>
                <span className={styles.logCell}>{record.timestamp}</span>
                <span className={styles.logCell}>{record.resourceId}</span>
                <span className={styles.logCell}>{record.type}</span>
                <span
                  className={`${styles.logCell} ${styles[`status${record.action}`]}`}
                >
                  {record.action}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
