"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AwsConnectForm from "@/app/components/AwsConnectForm";
import MetricsPanel from "@/app/components/MetricPanel";
import TabFilters from "@/app/components/TabFilters";
import {
  Home,
  BarChart3,
  Wallet,
  FileText,
  Bell,
  Settings,
  HelpCircle,
  LogOut,
} from "lucide-react";
import "../landing_page/index.css";
import styles from "./page.module.css";

export default function MainPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [findings, setFindings] = useState<any[]>([]);
  const [approved, setApproved] = useState(new Set<string>());
  const [dismissed, setDismissed] = useState(new Set<string>());
  const [activeTab, setActiveTab] = useState<"all" | "cost" | "security" | "logs" | "alerts">(
    "all",
  );
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);
  const [showAwsForm, setShowAwsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningResource, setScanningResource] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<any[]>([]);
  const [costTabScanned, setCostTabScanned] = useState(false);

  const [totalSavings, setTotalSavings] = useState(0);
  const [zombiesCount, setZombiesCount] = useState(0);

  const [alertConfigs, setAlertConfigs] = useState<any[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<any[]>([]);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [newAlert, setNewAlert] = useState({
    resourceType: "EC2",
    metric: "cpu",
    threshold: 10,
    thresholdType: "below",
    operator: "<",
  });

  useEffect(() => {
    if (!loading && !user) router.push("/src/login_page");
  }, [user, loading, router]);

  useEffect(() => {
    const activeFindings = findings.filter((f) => !dismissed.has(f.id));
    setZombiesCount(activeFindings.length);
    const savings = activeFindings.reduce((acc, curr) => {
      return acc + (parseInt(curr.save.replace(/[^0-9]/g, ""), 10) || 0);
    }, 0);
    setTotalSavings(savings);
  }, [findings, dismissed]);

  useEffect(() => {
    const newTriggeredAlerts: any[] = [];
    
    alertConfigs.forEach((config) => {
      findings.forEach((finding) => {
        if (!dismissed.has(finding.id)) {
          const metric = parseFloat(finding[config.metric.toLowerCase()] || 0);
          let triggered = false;

          if (config.thresholdType === "below") {
            triggered = metric < config.threshold;
          } else if (config.thresholdType === "above") {
            triggered = metric > config.threshold;
          }

          if (triggered && finding.type.includes(config.resourceType)) {
            const alertId = `${config.id}-${finding.id}`;
            const existingAlert = newTriggeredAlerts.find((a) => a.id === alertId);
            if (!existingAlert) {
              newTriggeredAlerts.push({
                id: alertId,
                configId: config.id,
                resourceId: finding.id,
                resourceType: finding.type,
                metric: config.metric,
                value: metric,
                threshold: config.threshold,
                condition: config.thresholdType,
                timestamp: new Date().toLocaleString(),
              });
            }
          }
        }
      });
    });

    setTriggeredAlerts(newTriggeredAlerts);

    if (alertConfigs.length > 0 && findings.length > 0) {
      try {
        fetch("http://localhost:8000/api/alerts/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            findings: findings,
            alertConfigs: alertConfigs,
          }),
        }).catch(err => console.log("Backend alert evaluation optional:", err));
      } catch (err) {
        console.log("Backend connection not available");
      }
    }
  }, [findings, alertConfigs, dismissed]);

  if (loading || !user) {
    return (
      <div className={styles.loadingContainer}>
        LOADING SECURE OPERATIONS CELL...
      </div>
    );
  }

  const handleScanSuccess = (liveData: any[]) => {
    setFindings(liveData);
    if (liveData.length > 0) setSelectedFinding(liveData[0]);
    setScanningResource(null);
    if (activeTab === "cost") setCostTabScanned(true);
  };

  const handleScanError = (errorMsg: string) => {
    setError(errorMsg);
    setScanningResource(null);
  };

  const handleApprove = async (id: string) => {
    const targetFinding = findings.find((f) => f.id === id);
    if (!targetFinding) return;
    let actionType = targetFinding.type.includes("Volume")
      ? "delete_volume"
      : targetFinding.type.includes("S3")
        ? "secure_s3"
        : "stop_instance";

    try {
      setError(null);
      setApproved((prev) => new Set(prev).add(id));
      const response = await fetch("http://localhost:8000/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aws_access_key: "demo",
          aws_secret_key: "12345",
          region:
            targetFinding.region === "global"
              ? "us-east-1"
              : targetFinding.region,
          resource_id: id,
          action_type: actionType,
        }),
      });
      if (response.ok) {
        setActionHistory((prev) => [
          ...prev,
          {
            id: Math.random().toString(36),
            resourceId: id,
            action: "Approved",
            type: targetFinding.type,
            timestamp: new Date().toLocaleString(),
          },
        ]);
        setTimeout(() => {
          setDismissed((prev) => new Set(prev).add(id));
          if (selectedFinding?.id === id) setSelectedFinding(null);
        }, 600);
      } else {
        const errData = await response.json();
        setError(errData.detail || "Failed to execute action");
        setApproved((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(errorMsg);
      setApproved((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleScanResourceType = async (resourceType: string) => {
    setScanningResource(resourceType);
    setError(null);
    try {
      const response = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aws_access_key: "demo",
          aws_secret_key: "12345",
          region: "us-east-1",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          const filtered = data.data.filter((f: any) =>
            f.type.toLowerCase().includes(resourceType.toLowerCase())
          );
          handleScanSuccess(filtered.length > 0 ? filtered : data.data);
        } else {
          handleScanError("Invalid response format from server");
        }
      } else {
        const errData = await response.json();
        handleScanError(errData.detail || `Failed to scan ${resourceType} resources`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred";
      handleScanError(errorMsg);
    }
  };

  const handleAddAlert = () => {
    if (!newAlert.threshold) {
      setError("Please set a threshold value");
      return;
    }
    const alert = {
      id: Math.random().toString(36),
      ...newAlert,
    };
    setAlertConfigs((prev) => [...prev, alert]);
    
    try {
      fetch("http://localhost:8000/api/alerts/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAlert),
      }).catch(err => console.log("Backend sync optional:", err));
    } catch (err) {
      console.log("Backend connection not available");
    }
    
    setNewAlert({
      resourceType: "EC2",
      metric: "cpu",
      threshold: 10,
      thresholdType: "below",
      operator: "<",
    });
    setError(null);
  };

  const handleRemoveAlert = (alertId: string) => {
    setAlertConfigs((prev) => prev.filter((a) => a.id !== alertId));
    
    try {
      fetch(`http://localhost:8000/api/alerts/config/${alertId}`, {
        method: "DELETE",
      }).catch(err => console.log("Backend sync optional:", err));
    } catch (err) {
      console.log("Backend connection not available");
    }
  };

  const filteredFindings = findings.filter((f) => {
    if (dismissed.has(f.id)) return false;
    if (activeTab === "cost")
      return f.type.includes("EC2") || f.type.includes("Volume");
    if (activeTab === "security") return f.type.includes("S3");
    return true;
  });

  return (
    <div className={styles.dashboardLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <span className={styles.logoText}>Tuff</span>
          <span className={styles.logoSubtext}>// console</span>
        </div>

        <nav className={styles.navLinks}>
          <button className={`${styles.navItem} ${activeTab === "all" ? styles.active : ""}`} onClick={() => setActiveTab("all")}>
            <Home size={18} />
            <span>Overview</span>
          </button>

          <button className={`${styles.navItem} ${activeTab === "cost" ? styles.active : ""}`} onClick={() => setActiveTab("cost")}>
            <Wallet size={18} />
            <span>Cost Explorer</span>
          </button>

          <button className={`${styles.navItem} ${activeTab === "logs" ? styles.active : ""}`} onClick={() => setActiveTab("logs")}>
            <BarChart3 size={18} />
            <span>Logs</span>
          </button>

          <button className={`${styles.navItem} ${activeTab === "alerts" ? styles.active : ""}`} onClick={() => setActiveTab("alerts")}>
            <Bell size={18} />
            <span>Alerts</span>
          </button>

          <button className={styles.navItem}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>

        <div className={styles.sidebarBottom}>
          <button 
            className={styles.navItem}
            onClick={() => {
              const saved = localStorage.getItem("aws_credentials");
              if (!saved) {
                setError("AWS credentials not configured. Please connect your AWS account first.");
                setShowAwsForm(true);
              } else {
                setShowAwsForm(true);
              }
            }}
          >
            <FileText size={18} />
            <span>Scan Resources</span>
          </button>

          <button 
            className={styles.connectAwsBtn}
            onClick={() => setShowAwsForm(!showAwsForm)}
          >
            <Wallet size={18} />
            <span>Connect AWS Account</span>
          </button>

          <button className={styles.navItem}>
            <HelpCircle size={18} />
            <span>Help</span>
          </button>

          <button
            onClick={logout}
            className={styles.logoutItem}
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>

          <div className={styles.userCard}>
            <div className={styles.avatar}>{user?.email?.[0]?.toUpperCase()}</div>
            <div>
              <h4>{user?.email?.split("@")[0]}</h4>
              <p>{user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      <main className={styles.mainContent}>
        <div className={styles.topbar}>
          <h1>
            {activeTab === "all" && "Cloud Resource Overview"}
            {activeTab === "cost" && "Cost Explorer"}
            {activeTab === "logs" && "Previous Actions & Logs"}
            {activeTab === "alerts" && "Alert Configuration & History"}
          </h1>
          <div className={styles.topbarRight}>
            <button className={styles.dateBtn}>
              {new Date().toLocaleDateString()}
            </button>
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            <div className={styles.errorContent}>
              <span className={styles.errorIcon}>⚠</span>
              <span className={styles.errorMessage}>{error}</span>
            </div>
            <button
              className={styles.errorClose}
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {activeTab !== "cost" && activeTab !== "logs" && activeTab !== "alerts" && (
          <div className={styles.statsGrid}>
            <div className={styles.card}>
              <p className={styles.statLabel}>Active Resources</p>
              <h2 className={styles.statValue}>{findings.length}</h2>
              <span className={styles.positive}>{filteredFindings.length} requiring action</span>
            </div>

            <div className={styles.card}>
              <p className={styles.statLabel}>Total Potential Savings</p>
              <h2 className={styles.statValue}>${(totalSavings / 1000).toFixed(1)}K</h2>
              <span className={styles.positive}>▲ Monthly</span>
            </div>

            <div className={styles.card}>
              <p className={styles.statLabel}>Approved</p>
              <h2 className={styles.statValue}>{approved.size}</h2>
              <span>Actions processed</span>
            </div>

            <button 
              className={styles.card}
              onClick={() => setActiveTab("alerts")}
              style={{ cursor: "pointer", background: "linear-gradient(135deg, rgba(100, 140, 80, 0.12), rgba(100, 140, 80, 0.06))", border: "1px solid rgba(100, 140, 80, 0.3)" }}
            >
              <p className={styles.statLabel}>Alerts</p>
              <h2 className={styles.statValue}>{alertConfigs.length}</h2>
              <span className={styles.positive}>{triggeredAlerts.length} triggered</span>
            </button>
          </div>
        )}

        {activeTab === "cost" && !costTabScanned && (
          <div className={styles.resourceCardsPanel}>
            <h3 className={styles.scannerTitle}>Select Resource Type to Analyze</h3>
            <div className={styles.resourceCardsGrid}>
              <button
                className={`${styles.resourceCard} ${scanningResource === "ec2" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("EC2")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>EC2 Instances</div>
                <div className={styles.cardDesc}>Find idle or underutilized instances</div>
                {scanningResource === "ec2" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
              <button
                className={`${styles.resourceCard} ${scanningResource === "volume" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("Volume")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>EBS Volumes</div>
                <div className={styles.cardDesc}>Detect unattached or unused volumes</div>
                {scanningResource === "volume" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
              <button
                className={`${styles.resourceCard} ${scanningResource === "s3" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("S3")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>S3 Buckets</div>
                <div className={styles.cardDesc}>Identify misconfigured or public buckets</div>
                {scanningResource === "s3" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
              <button
                className={`${styles.resourceCard} ${scanningResource === "vpc" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("VPC")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>VPCs</div>
                <div className={styles.cardDesc}>Find unused VPCs and resources</div>
                {scanningResource === "vpc" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
              <button
                className={`${styles.resourceCard} ${scanningResource === "rds" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("RDS")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>RDS Databases</div>
                <div className={styles.cardDesc}>Detect idle database instances</div>
                {scanningResource === "rds" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
              <button
                className={`${styles.resourceCard} ${scanningResource === "all" ? styles.scanning : ""}`}
                onClick={() => handleScanResourceType("all")}
                disabled={scanningResource !== null}
              >
                <div className={styles.cardTitle}>All Resources</div>
                <div className={styles.cardDesc}>Comprehensive infrastructure scan</div>
                {scanningResource === "all" && <div className={styles.cardLoading}>⟳ Scanning...</div>}
              </button>
            </div>
          </div>
        )}

        {showAwsForm && (
          <div className={styles.largeCard}>
            <div className={styles.cardHeader}>
              <h3>Connect AWS Account</h3>
              <button 
                className={styles.closeBtn}
                onClick={() => setShowAwsForm(false)}
              >
                ✕
              </button>
            </div>
            <AwsConnectForm onScanComplete={handleScanSuccess} />
          </div>
        )}

        <div className={styles.chartGrid}>
          {activeTab === "logs" ? (
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
                        <span className={`${styles.logCell} ${styles[`status${record.action}`]}`}>
                          {record.action}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : activeTab === "alerts" ? (
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
                          setNewAlert({ ...newAlert, resourceType: e.target.value })
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
                          setNewAlert({ ...newAlert, thresholdType: e.target.value })
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
                      onClick={handleAddAlert}
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
                          <span className={styles.configCell}>{config.resourceType}</span>
                          <span className={styles.configCell}>{config.metric}</span>
                          <span className={styles.configCell}>{config.thresholdType}</span>
                          <span className={styles.configCell}>{config.threshold}</span>
                          <button
                            className={styles.removeAlertBtn}
                            onClick={() => handleRemoveAlert(config.id)}
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
                          <span className={styles.historyCell}>{alert.resourceId}</span>
                          <span className={styles.historyCell}>{alert.resourceType}</span>
                          <span className={styles.historyCell}>{alert.metric}</span>
                          <span className={styles.historyCell}>{alert.value}</span>
                          <span className={styles.historyCell}>{alert.threshold}</span>
                          <span className={`${styles.historyCell} ${styles[`alertCondition${alert.condition}`]}`}>
                            {alert.condition}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            (activeTab !== "cost" || costTabScanned) && (
              <div className={`${styles.largeCard} ${styles.findingsCard}`}>
                <div className={styles.cardHeader}>
                  <h3>Cloud Resources Requiring Action</h3>
                  <TabFilters
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    allCount={findings.filter((f) => !dismissed.has(f.id)).length}
                    costCount={
                      findings.filter(
                        (f) =>
                          !dismissed.has(f.id) &&
                          (f.type.includes("EC2") || f.type.includes("Volume")),
                      ).length
                    }
                    securityCount={
                      findings.filter(
                        (f) => !dismissed.has(f.id) && f.type.includes("S3"),
                      ).length
                    }
                  />
                </div>

                <div className={styles.queueCols}>
                  <span className={styles.colLabel}>Resource ID</span>
                  <span className={styles.colLabel}>Type</span>
                  <span className={styles.colLabel}>Region</span>
                  <span className={styles.colLabel}>Cost</span>
                  <span className={styles.colLabel}>Savings</span>
                  <span className={styles.colLabel}>CPU</span>
                  <span className={styles.colLabel}>Action</span>
                </div>

                <div id="findings" className={styles.findingsContainer}>
                  {findings.length === 0 ? (
                    <div className={styles.emptyState}>
                      Awaiting secure cloud execution authorization mapping coordinates.
                    </div>
                  ) : filteredFindings.length === 0 ? (
                    <div className={styles.emptyStateFiltered}>
                      No alerts matched filter profile.
                    </div>
                  ) : (
                    filteredFindings.map((f) => (
                      <div
                        key={f.id}
                        className={styles.findingRow}
                        onClick={() => setSelectedFinding(f)}
                      >
                        <div className={styles.findingIdWrapper}>
                          <div className={styles.findingId}>{f.id}</div>
                          <div className={styles.findingInst}>{f.inst}</div>
                        </div>
                        <div>
                          <span className={styles.badge}>{f.type}</span>
                        </div>
                        <div className={styles.findingRegion}>{f.region}</div>
                        <div className={styles.findingCost}>{f.cur}</div>
                        <div className={styles.findingSave}>{f.save}</div>
                        <div className={styles.findingCpu}>{f.cpu}</div>
                        <div
                          className={styles.actionButtons}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {approved.has(f.id) ? (
                            <span className={styles.executingStatus}>
                              ⚙ EXECUTING...
                            </span>
                          ) : (
                            <>
                              <button
                                className={styles.approveBtn}
                                onClick={() => handleApprove(f.id)}
                              >
                                Approve
                              </button>
                              <button
                                className={styles.dismissBtn}
                                onClick={() => {
                                  setActionHistory((prev) => [
                                    ...prev,
                                    {
                                      id: Math.random().toString(36),
                                      resourceId: f.id,
                                      action: "Dismissed",
                                      type: f.type,
                                      timestamp: new Date().toLocaleString(),
                                    },
                                  ]);
                                  setDismissed((prev) => new Set(prev).add(f.id));
                                }}
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {selectedFinding && (
                  <div className={styles.detailPanel}>
                    <div className={styles.detailHeader}>
                      <div>
                        <h2 className={styles.detailTitle}>{selectedFinding.id}</h2>
                        <p className={styles.detailType}>{selectedFinding.type}</p>
                      </div>
                      <button 
                        className={styles.closeBtn}
                        onClick={() => setSelectedFinding(null)}
                        aria-label="Close detail panel"
                      >
                        ✕
                      </button>
                    </div>

                    <div className={styles.detailContent}>
                      <div className={styles.detailSection}>
                        <h3 className={styles.sectionTitle}>Overview</h3>
                        <div className={styles.detailGrid}>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>Resource Region</span>
                            <span className={styles.detailValue}>{selectedFinding.region}</span>
                          </div>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>Instance Type</span>
                            <span className={styles.detailValue}>{selectedFinding.inst}</span>
                          </div>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>Priority</span>
                            <span className={`${styles.detailValue} ${styles[`priority${selectedFinding.priority || 'medium'}`]}`}>
                              {selectedFinding.priority?.toUpperCase() || 'MEDIUM'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className={styles.detailSection}>
                        <h3 className={styles.sectionTitle}>Cost & Impact</h3>
                        <div className={styles.detailGrid}>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>Current Monthly Cost</span>
                            <span className={styles.detailValue}>{selectedFinding.cur}</span>
                          </div>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>Potential Monthly Savings</span>
                            <span className={`${styles.detailValue} ${styles.savingsValue}`}>{selectedFinding.save}</span>
                          </div>
                          <div className={styles.detailItem}>
                            <span className={styles.detailLabel}>CPU Utilization</span>
                            <span className={styles.detailValue}>{selectedFinding.cpu}</span>
                          </div>
                        </div>
                      </div>
                      <div className={styles.detailSection}>
                        <h3 className={styles.sectionTitle}>AI Analysis & Insights</h3>
                        
                        {selectedFinding.explanation && (
                          <div className={styles.insightBox}>
                            <div className={styles.insightLabel}>Issue Explanation</div>
                            <p className={styles.insightText}>{selectedFinding.explanation}</p>
                          </div>
                        )}

                        {selectedFinding.business_impact && (
                          <div className={styles.insightBox}>
                            <div className={styles.insightLabel}>Business Impact</div>
                            <p className={styles.insightText}>{selectedFinding.business_impact}</p>
                          </div>
                        )}

                        {selectedFinding.recommended_action && (
                          <div className={styles.insightBox}>
                            <div className={styles.insightLabel}>Recommended Action</div>
                            <p className={styles.insightText}>{selectedFinding.recommended_action}</p>
                          </div>
                        )}
                      </div>

                      <div className={styles.detailActions}>
                        {approved.has(selectedFinding.id) ? (
                          <span className={styles.executingStatus}>
                            ⚙ EXECUTING...
                          </span>
                        ) : (
                          <>
                            <button
                              className={styles.detailApproveBtn}
                              onClick={() => handleApprove(selectedFinding.id)}
                            >
                              Approve & Execute
                            </button>
                            <button
                              className={styles.detailDismissBtn}
                              onClick={() => {
                                setActionHistory((prev) => [
                                  ...prev,
                                  {
                                    id: Math.random().toString(36),
                                    resourceId: selectedFinding.id,
                                    action: "Dismissed",
                                    type: selectedFinding.type,
                                    timestamp: new Date().toLocaleString(),
                                  },
                                ]);
                                setDismissed((prev) => new Set(prev).add(selectedFinding.id));
                              }}
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
