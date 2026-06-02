import { useState } from "react";
import styles from "@/app/src/main_page/page.module.css";

interface AlertConfig {
  id: string;
  resourceType: string;
  metric: string;
  threshold: number;
  thresholdType: string;
}

interface TriggeredAlert {
  id: string;
  configId: string;
  resourceId: string;
  resourceType: string;
  metric: string;
  value: number;
  threshold: number;
  condition: string;
  timestamp: string;
}

interface AlertsPanelProps {
  alertConfigs: AlertConfig[];
  triggeredAlerts: TriggeredAlert[];
  onAddAlert: (alert: Omit<AlertConfig, "id">) => void;
  onRemoveAlert: (alertId: string) => void;
}

export default function AlertsPanel({
  alertConfigs,
  triggeredAlerts,
  onAddAlert,
  onRemoveAlert,
}: AlertsPanelProps) {
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [newAlert, setNewAlert] = useState({
    resourceType: "EC2",
    metric: "cpu",
    threshold: 10,
    thresholdType: "below",
  });

  const handleCreateAlert = () => {
    if (!newAlert.threshold) return;
    onAddAlert(newAlert as Omit<AlertConfig, "id">);
    setNewAlert({
      resourceType: "EC2",
      metric: "cpu",
      threshold: 10,
      thresholdType: "below",
    });
  };

  return (
    <>
      <div className={`${styles.largeCard} ${styles.alertConfigCard}`}>
        <div className={styles.cardHeader}>
          <h3>Configure Alerts</h3>
          <button
            className={styles.addAlertBtn}
            onClick={() => setShowAlertForm(!showAlertForm)}
          >
            {showAlertForm ? "✕ Close" : "+ Add Alert"}
          </button>
        </div>

        {showAlertForm && (
          <div className={styles.alertForm}>
            <div className={styles.formGroup}>
              <label>Resource Type</label>
              <select
                value={newAlert.resourceType}
                onChange={(e) =>
                  setNewAlert({
                    ...newAlert,
                    resourceType: e.target.value,
                  })
                }
                className={styles.formInput}
              >
                <option value="EC2">EC2 Instances</option>
                <option value="Volume">EBS Volumes</option>
                <option value="S3">S3 Buckets</option>
                <option value="RDS">RDS Databases</option>
                <option value="VPC">VPCs</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Metric</label>
              <select
                value={newAlert.metric}
                onChange={(e) =>
                  setNewAlert({ ...newAlert, metric: e.target.value })
                }
                className={styles.formInput}
              >
                <option value="cpu">CPU Utilization (%)</option>
                <option value="save">Monthly Savings ($)</option>
                <option value="cur">Current Cost ($)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Condition</label>
              <select
                value={newAlert.thresholdType}
                onChange={(e) =>
                  setNewAlert({
                    ...newAlert,
                    thresholdType: e.target.value,
                  })
                }
                className={styles.formInput}
              >
                <option value="below">Below</option>
                <option value="above">Above</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Threshold Value</label>
              <input
                type="number"
                value={newAlert.threshold}
                onChange={(e) =>
                  setNewAlert({
                    ...newAlert,
                    threshold: parseFloat(e.target.value) || 0,
                  })
                }
                className={styles.formInput}
                placeholder="Enter threshold value"
              />
            </div>

            <button
              className={styles.createAlertBtn}
              onClick={handleCreateAlert}
            >
              Create Alert
            </button>
          </div>
        )}

        <div className={styles.alertConfigList}>
          {alertConfigs.length === 0 ? (
            <div className={styles.emptyState}>
              No alerts configured yet. Create one to get started.
            </div>
          ) : (
            <>
              <div className={styles.alertConfigHeader}>
                <span className={styles.configCol}>Resource Type</span>
                <span className={styles.configCol}>Metric</span>
                <span className={styles.configCol}>Condition</span>
                <span className={styles.configCol}>Threshold</span>
                <span className={styles.configCol}>Action</span>
              </div>
              {alertConfigs.map((config) => (
                <div key={config.id} className={styles.alertConfigRow}>
                  <span className={styles.configCell}>
                    {config.resourceType}
                  </span>
                  <span className={styles.configCell}>{config.metric}</span>
                  <span className={styles.configCell}>
                    {config.thresholdType}
                  </span>
                  <span className={styles.configCell}>{config.threshold}</span>
                  <button
                    className={styles.removeAlertBtn}
                    onClick={() => onRemoveAlert(config.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className={`${styles.largeCard} ${styles.alertHistoryCard}`}>
        <div className={styles.cardHeader}>
          <h3>Triggered Alerts ({triggeredAlerts.length})</h3>
        </div>

        {triggeredAlerts.length === 0 ? (
          <div className={styles.emptyState}>
            No alerts triggered. All resources within configured thresholds.
          </div>
        ) : (
          <>
            <div className={styles.alertHistoryHeader}>
              <span className={styles.historyCol}>Timestamp</span>
              <span className={styles.historyCol}>Resource ID</span>
              <span className={styles.historyCol}>Type</span>
              <span className={styles.historyCol}>Metric</span>
              <span className={styles.historyCol}>Value</span>
              <span className={styles.historyCol}>Threshold</span>
              <span className={styles.historyCol}>Condition</span>
            </div>
            <div className={styles.alertHistoryContainer}>
              {[...triggeredAlerts].reverse().map((alert) => (
                <div key={alert.id} className={styles.alertHistoryRow}>
                  <span className={styles.historyCell}>{alert.timestamp}</span>
                  <span className={styles.historyCell}>
                    {alert.resourceId}
                  </span>
                  <span className={styles.historyCell}>
                    {alert.resourceType}
                  </span>
                  <span className={styles.historyCell}>{alert.metric}</span>
                  <span className={styles.historyCell}>{alert.value}</span>
                  <span className={styles.historyCell}>{alert.threshold}</span>
                  <span
                    className={`${styles.historyCell} ${styles[`alertCondition${alert.condition}`]}`}
                  >
                    {alert.condition}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
