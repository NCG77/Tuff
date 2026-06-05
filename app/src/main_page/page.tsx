"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AwsConnectForm from "@/app/components/AwsConnectForm";
import StatsPanel from "@/app/components/StatsPanel";
import ResourceScanner from "@/app/components/ResourceScanner";
import LogsPanel from "@/app/components/LogsPanel";
import AlertsPanel from "@/app/components/AlertsPanel";
import FindingsPanel from "@/app/components/FindingsPanel";
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
import { api, devLog, devError } from "@/app/lib/config";
import "../landing_page/index.css";
import styles from "./page.module.css";

export default function MainPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [findings, setFindings] = useState<any[]>([]);
  const [approved, setApproved] = useState(new Set<string>());
  const [dismissed, setDismissed] = useState(new Set<string>());
  const [activeTab, setActiveTab] = useState<
    "all" | "cost" | "security" | "logs" | "alerts"
  >("all");
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);
  const [showAwsForm, setShowAwsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningResource, setScanningResource] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<any[]>([]);
  const [costTabScanned, setCostTabScanned] = useState(false);

  const [totalSavings, setTotalSavings] = useState(0);

  const [alertConfigs, setAlertConfigs] = useState<any[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<any[]>([]);
  const [newAlert, setNewAlert] = useState({
    resourceType: "EC2",
    metric: "cpu",
    threshold: 10,
    thresholdType: "below",
    operator: "<",
  });
  const [activeCredentials, setActiveCredentials] = useState<{
    keyId: string;
    secretKey: string;
  } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/src/login_page");
  }, [user, loading, router]);

  // Load user data from database on mount
  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.email) return;

      try {
        // Fetch alerts
        const alertsRes = await fetch(`${api.endpoints.alertsConfig}?user_id=${user.email}`);
        if (alertsRes.ok) {
          const alertsData = await alertsRes.json();
          setAlertConfigs(alertsData.configs || []);
        }

        // Fetch action history
        const logsRes = await fetch(`${api.endpoints.actionLogs}?user_id=${user.email}`);
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          const formattedLogs = logsData.logs.map((log: any) => ({
            id: log.id,
            resourceId: log.resource_id,
            action: log.action,
            type: log.type,
            timestamp: log.timestamp,
          }));
          setActionHistory(formattedLogs);
        }

        // Fetch triggered alerts
        const triggeredRes = await fetch(`${api.endpoints.alertsTriggered}?user_id=${user.email}`);
        if (triggeredRes.ok) {
          const triggeredData = await triggeredRes.json();
          setTriggeredAlerts(triggeredData.alerts || []);
        }
      } catch (err) {
        devError("Failed to load user data:", err);
      }
    };

    loadUserData();
  }, [user?.email]);

  useEffect(() => {
    const activeFindings = findings.filter((f) => !dismissed.has(f.id));

    const savings = activeFindings.reduce((acc, curr) => {
      const cleanNumericString = curr.save.replace(/[^0-9.]/g, "");
      const parsedValue = parseFloat(cleanNumericString) || 0;
      return acc + parsedValue;
    }, 0);

    setTotalSavings(Number(savings.toFixed(2)));
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
            const existingAlert = newTriggeredAlerts.find(
              (a) => a.id === alertId,
            );
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
        fetch(api.endpoints.alertsEvaluate, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            findings: findings,
            alertConfigs: alertConfigs,
          }),
        }).catch((err) =>
          devLog("Backend alert evaluation optional:", err),
        );
      } catch (err) {
        devLog("Backend connection not available");
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

  const handleScanSuccess = (
    liveData: any[],
    credentials?: { keyId: string; secretKey: string },
  ) => {
    setFindings(liveData);
    if (credentials) setActiveCredentials(credentials);
    if (liveData.length > 0) setSelectedFinding(liveData[0]);
  };

  const handleScanError = (errorMsg: string) => {
    setError(errorMsg);
    setScanningResource(null);
  };

  const handleApprove = async (id: string) => {
    const targetFinding = findings.find((f) => f.id === id);
    if (!targetFinding) return;
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    let actionType = "stop_instance";
    if (targetFinding.type.includes("Volume")) {
      actionType = "delete_volume";
    } else if (targetFinding.type.includes("S3")) {
      actionType = "secure_s3";
    } else if (targetFinding.type.includes("Scaling")) {
      actionType = "scale_instance";
    }

    try {
      const keyToSend = activeCredentials?.keyId || "demo";
      const secretToSend = activeCredentials?.secretKey || "12345";
      setError(null);
      setApproved((prev) => new Set(prev).add(id));

      const response = await fetch(api.endpoints.execute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aws_access_key: keyToSend,
          aws_secret_key: secretToSend,
          region:
            targetFinding.region === "global"
              ? "us-east-1"
              : targetFinding.region,
          resource_id: id,
          action_type: actionType,
          target_type: targetFinding.metrics?.suggested_type || "t3.micro",
          user_id: user.email,
        }),
      });

      if (response.ok) {
        const logEntry = {
          id: Math.random().toString(36),
          resourceId: id,
          action: "Approved",
          type: targetFinding.type,
          timestamp: new Date().toLocaleString(),
        };

        setActionHistory((prev) => [...prev, logEntry]);

        // Save to database
        try {
          fetch(api.endpoints.actionLogs, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: user.email,
              resource_id: id,
              action: "Approved",
              resource_type: targetFinding.type,
            }),
          }).catch((err) => devLog("Backend sync optional:", err));
        } catch (err) {
          devLog("Backend connection not available");
        }

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
      const errorMsg =
        err instanceof Error ? err.message : "An unexpected error occurred";
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

    // 1. Initialize credential and region targets as blank/dynamic states
    let keyId = activeCredentials?.keyId;
    let secretKey = activeCredentials?.secretKey;
    let targetRegion = "";
    const saved = localStorage.getItem("aws_credentials");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        keyId = keyId || parsed.accessKey;
        secretKey = secretKey || parsed.secretKey;
        targetRegion = parsed.region;
      } catch (e) {
        console.error("Failed to parse saved credentials:", e);
      }
    }
    if (!targetRegion) {
      targetRegion =
        findings.length > 0 && findings[0].region !== "global"
          ? findings[0].region
          : "us-east-1";
    }

    try {
      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aws_access_key: keyId || "demo",
          aws_secret_key: secretKey || "12345",
          region: targetRegion,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          if (resourceType === "all") {
            handleScanSuccess(data.data);
          } else {
            const filtered = data.data.filter((f: any) =>
              f.type.toLowerCase().includes(resourceType.toLowerCase()),
            );
            handleScanSuccess(filtered.length > 0 ? filtered : data.data);
          }
          setCostTabScanned(true);
        } else {
          handleScanError("Invalid response format from server");
        }
      } else {
        const errData = await response.json();
        handleScanError(
          errData.detail || `Failed to scan ${resourceType} resources`,
        );
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "An unexpected error occurred";
      handleScanError(errorMsg);
    } finally {
      setScanningResource(null);
    }
  };

  const handleAddAlert = () => {
    if (!newAlert.threshold) {
      setError("Please set a threshold value");
      return;
    }
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    const alert = {
      id: Math.random().toString(36),
      ...newAlert,
    };
    setAlertConfigs((prev) => [...prev, alert]);

    try {
      fetch(api.endpoints.alertsConfig, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newAlert,
          user_id: user.email,
        }),
      }).catch((err) => devLog("Backend sync optional:", err));
    } catch (err) {
      devLog("Backend connection not available");
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
      fetch(`${api.endpoints.alertsConfig}/${alertId}`, {
        method: "DELETE",
      }).catch((err) => devLog("Backend sync optional:", err));
    } catch (err) {
      devLog("Backend connection not available");
    }
  };

  const handleDismissWithHistory = (id: string, finding: any) => {
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    const logEntry = {
      id: Math.random().toString(36),
      resourceId: id,
      action: "Dismissed",
      type: finding.type,
      timestamp: new Date().toLocaleString(),
    };

    setActionHistory((prev) => [...prev, logEntry]);
    setDismissed((prev) => new Set(prev).add(id));
    if (selectedFinding?.id === id) setSelectedFinding(null);

    // Save to database
    try {
      fetch(api.endpoints.actionLogs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.email,
          resource_id: id,
          action: "Dismissed",
          resource_type: finding.type,
        }),
      }).catch((err) => devLog("Backend sync optional:", err));
    } catch (err) {
      devLog("Backend connection not available");
    }
  };

  return (
    <div className={styles.dashboardLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <span className={styles.logoText}>Tuff</span>
          <span className={styles.logoSubtext}>// console</span>
        </div>

        <nav className={styles.navLinks}>
          <button
            className={`${styles.navItem} ${activeTab === "all" ? styles.active : ""}`}
            onClick={() => setActiveTab("all")}
          >
            <Home size={18} />
            <span>Overview</span>
          </button>

          <button
            className={`${styles.navItem} ${activeTab === "cost" ? styles.active : ""}`}
            onClick={() => setActiveTab("cost")}
          >
            <Wallet size={18} />
            <span>Cost Explorer</span>
          </button>

          <button
            className={`${styles.navItem} ${activeTab === "logs" ? styles.active : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            <BarChart3 size={18} />
            <span>Logs</span>
          </button>

          <button
            className={`${styles.navItem} ${activeTab === "alerts" ? styles.active : ""}`}
            onClick={() => setActiveTab("alerts")}
          >
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
                setError(
                  "AWS credentials not configured. Please connect your AWS account first.",
                );
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

          <button onClick={logout} className={styles.logoutItem}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>

          <div className={styles.userCard}>
            <div className={styles.avatar}>
              {user?.email?.[0]?.toUpperCase()}
            </div>
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

        {activeTab !== "cost" &&
          activeTab !== "logs" &&
          activeTab !== "alerts" && (
            <StatsPanel
              findings={findings}
              dismissed={dismissed}
              totalSavings={totalSavings}
              approved={approved}
              alertConfigs={alertConfigs}
              triggeredAlerts={triggeredAlerts}
              onAlertTabClick={() => setActiveTab("alerts")}
            />
          )}

        {activeTab === "cost" && !costTabScanned && (
          <ResourceScanner
            scanningResource={scanningResource}
            onScanResourceType={handleScanResourceType}
          />
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
            <LogsPanel actionHistory={actionHistory} />
          ) : activeTab === "alerts" ? (
            <AlertsPanel
              alertConfigs={alertConfigs}
              triggeredAlerts={triggeredAlerts}
              onAddAlert={handleAddAlert}
              onRemoveAlert={handleRemoveAlert}
            />
          ) : (
            (activeTab !== "cost" || costTabScanned) && (
              <FindingsPanel
                findings={findings}
                dismissed={dismissed}
                approved={approved}
                selectedFinding={selectedFinding}
                activeTab={activeTab}
                onSelectFinding={setSelectedFinding}
                onApprove={handleApprove}
                onDismiss={handleDismissWithHistory}
                setActiveTab={setActiveTab}
              />
            )
          )}
        </div>
      </main>
    </div>
  );
}
