import styles from "@/app/src/main_page/page.module.css";
import { formatRelativeTime, formatTimestamp } from "@/app/lib/format";
import type { ActionRecord } from "@/app/lib/types";

interface LogsPanelProps {
  actionHistory: ActionRecord[];
}

export default function LogsPanel({ actionHistory }: LogsPanelProps) {
  return (
    <div className={`${styles.largeCard} ${styles.logsCard}`}>
      <div className={styles.cardHeader}>
        <h3>Action History</h3>
        {actionHistory.length > 0 && (
          <span style={{ fontSize: "12px", color: "#8b7355" }}>
            {actionHistory.length} record{actionHistory.length === 1 ? "" : "s"} · newest first
          </span>
        )}
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
            {/* Rendered in the order received. The API already sorts newest
                first, and reversing it here pushed the newest entry to the
                bottom of a scrolling list. */}
            {actionHistory.map((record) => (
              <div key={record.id} className={styles.logRow}>
                <span className={styles.logCell} title={formatTimestamp(record.timestamp)}>
                  {formatRelativeTime(record.timestamp) || formatTimestamp(record.timestamp)}
                </span>
                <span className={styles.logCell}>{record.resourceId}</span>
                <span className={styles.logCell}>{record.type}</span>
                <span className={`${styles.logCell} ${styles[`status${record.action}`]}`}>
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
