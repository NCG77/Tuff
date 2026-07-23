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
import PricingModal from "@/app/components/PricingModal";
import HelpPanel from "@/app/components/HelpPanel";
import {
  Home,
  BarChart3,
  Wallet,
  FileText,
  Bell,
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
    "all" | "cost" | "security" | "logs" | "alerts" | "help"
  >("all");
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);
  const [showAwsForm, setShowAwsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningResource, setScanningResource] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<any[]>([]);
  const [costTabScanned, setCostTabScanned] = useState(false);

  const [totalSavings, setTotalSavings] = useState(0);

  const [tier, setTier] = useState<string>("free");
  const [credits, setCredits] = useState<number>(0);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

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

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      try {
        const token = await user.getIdToken();
        const headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        };

        const syncPromise = fetch(`${api.baseURL}/api/user/sync`, { method: "POST", headers })
          .then(res => res.ok ? res.json() : null)
          .catch(e => devLog("Sync failed:", e));

        const alertsPromise = fetch(api.endpoints.alertsConfig, { headers })
          .then(res => res.ok ? res.json() : null)
          .catch(e => null);
          
        const logsPromise = fetch(api.endpoints.actionLogs, { headers })
          .then(res => res.ok ? res.json() : null)
          .catch(e => null);

        const triggeredPromise = fetch(api.endpoints.alertsTriggered, { headers })
          .then(res => res.ok ? res.json() : null)
          .catch(e => null);

        const [syncData, alertsData, logsData, triggeredData] = await Promise.all([
          syncPromise, alertsPromise, logsPromise, triggeredPromise
        ]);

        if (syncData) {
          setTier(syncData.tier);
          setCredits(syncData.credits);
        }
        if (alertsData) {
          setAlertConfigs(alertsData.configs || []);
        }
        if (logsData) {
          const formattedLogs = logsData.logs.map((log: any) => ({
            id: log.id,
            resourceId: log.resource_id,
            action: log.action,
            type: log.type,
            timestamp: log.timestamp,
          }));
          setActionHistory(formattedLogs);
        }
        if (triggeredData) {
          setTriggeredAlerts(triggeredData.alerts || []);
        }

      } catch (err) {
        devError("Failed to load user data:", err);
      }
    };

    loadUserData();
  }, [user, activeTab]); 

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
    if (alertConfigs.length === 0 || findings.length === 0) {
      setTriggeredAlerts([]);
      return;
    }

    const worker = new Worker(
      new URL("../../workers/alertWorker.ts", import.meta.url),
    );

    worker.onmessage = (event) => {
      setTriggeredAlerts((prevAlerts) => {
        const newAlerts = event.data;
        newAlerts.forEach((alert: any) => {
          if (!prevAlerts.find((pa: any) => pa.id === alert.id)) {
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              new Notification("Tuff Alert Triggered", {
                body: `Resource ${alert.resourceId} (${alert.resourceType}) triggered ${alert.metric} alert!`,
                icon: "/favicon.ico"
              });
            }
          }
        });
        return newAlerts;
      });
    };

    worker.postMessage({
      alertConfigs,
      findings,
      dismissedList: Array.from(dismissed),
    });

    if (user) {
      const evaluateAlertsBackend = async () => {
        try {
          const token = await user.getIdToken();
          const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          };
          fetch(api.endpoints.alertsEvaluate, {
            method: "POST",
            headers,
            body: JSON.stringify({
              findings: findings,
              alertConfigs: alertConfigs,
            }),
          }).catch((err) => devLog("Backend alert evaluation optional:", err));
        } catch (err) {
          devLog("Backend connection not available", err);
        }
      };
      evaluateAlertsBackend();
    }

    return () => {
      worker.terminate();
    };
  }, [findings, alertConfigs, dismissed, user]);

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
    setCostTabScanned(true);
    setShowAwsForm(false);
  };

  const handleScanError = (errorMsg: string) => {
    setError(errorMsg);
    setScanningResource(null);
  };

  const handleApprove = async (id: string, actionTypeOverride?: string, targetTypeOverride?: string) => {
    const targetFinding = findings.find((f) => f.id === id);
    if (!targetFinding) return;
    if (!user) {
      setError("User not authenticated");
      return;
    }

    let actionType = actionTypeOverride || "stop_instance";
    if (!actionTypeOverride) {
      if (targetFinding.type.includes("Volume")) {
        actionType = "delete_volume";
      } else if (targetFinding.type.includes("S3")) {
        actionType = "secure_s3";
      } else if (targetFinding.type.includes("Scaling")) {
        actionType = "scale_instance";
      } else if (targetFinding.type.includes("RDS")) {
        actionType = "stop_rds";
      } else if (targetFinding.type.includes("VPC")) {
        actionType = "delete_vpc";
      }
    }

    try {
      const keyToSend = activeCredentials?.keyId || "demo";
      const secretToSend = activeCredentials?.secretKey || "12345";
      setError(null);
      setApproved((prev) => new Set(prev).add(id));

      const token = await user.getIdToken();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };

      const response = await fetch(api.endpoints.execute, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aws_access_key: keyToSend,
          aws_secret_key: secretToSend,
          region:
            targetFinding.region === "global"
              ? "us-east-1"
              : targetFinding.region,
          resource_id: id,
          action_type: actionType,
          target_type: targetTypeOverride || targetFinding.metrics?.suggested_type || "t3.micro",
          user_id: user.email,
        }),
      });

      if (response.ok) {
        try {
          const res = await fetch(api.endpoints.actionLogs, {
            method: "POST",
            headers,
            body: JSON.stringify({
              user_id: user.email,
              resource_id: id,
              action: "Approved",
              resource_type: targetFinding.type,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const logEntry = {
              id: data.log_id,
              resourceId: id,
              action: "Approved",
              type: targetFinding.type,
              timestamp: data.timestamp,
            };
            setActionHistory((prev) => [logEntry, ...prev]);
          }
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

  const handleScanResourceType = async (resourceType: string, regionOverride?: string) => {
    setScanningResource(resourceType);
    setError(null);

    let keyId = activeCredentials?.keyId;
    let secretKey = activeCredentials?.secretKey;
    let targetRegion = regionOverride || "";
    const saved = localStorage.getItem("aws_credentials");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        keyId = keyId || parsed.accessKey;
        secretKey = secretKey || parsed.secretKey;
        if (!targetRegion) targetRegion = parsed.region;
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
      const token = await user.getIdToken();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };

      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        headers,
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

  const handleAddAlert = async (alertData: Omit<any, "id">) => {
    if (!alertData.threshold) {
      setError("Please set a threshold value");
      return;
    }
    if (!user) {
      setError("User not authenticated");
      return;
    }

    try {
      const token = await user.getIdToken();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };
      const res = await fetch(api.endpoints.alertsConfig, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...alertData,
          user_id: user.email,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const alert = {
          id: data.alert.id,
          ...alertData,
        };
        setAlertConfigs((prev) => [...prev, alert]);
      } else {
        const errData = await res.json();
        setError(errData.detail || "Failed to save alert");
        return;
      }
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

  const handleRemoveAlert = async (alertId: string) => {
    setAlertConfigs((prev) => prev.filter((a) => a.id !== alertId));

    if (!user) return;

    try {
      const token = await user.getIdToken();
      const headers = {
        "Authorization": `Bearer ${token}`,
      };
      await fetch(`${api.endpoints.alertsConfig}/${alertId}`, {
        method: "DELETE",
        headers,
      });
    } catch (err) {
      devLog("Backend connection not available");
    }
  };

  const handleDismissWithHistory = async (id: string, finding: any) => {
    if (!user) {
      setError("User not authenticated");
      return;
    }

    setDismissed((prev) => new Set(prev).add(id));
    if (selectedFinding?.id === id) setSelectedFinding(null);

    try {
      const token = await user.getIdToken();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };
      const res = await fetch(api.endpoints.actionLogs, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: user.email,
          resource_id: id,
          action: "Dismissed",
          resource_type: finding.type,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const logEntry = {
          id: data.log_id,
          resourceId: id,
          action: "Dismissed",
          type: finding.type,
          timestamp: data.timestamp,
        };
        setActionHistory((prev) => [logEntry, ...prev]);
      }
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
                setActiveTab("cost");
                setCostTabScanned(false);
                handleScanResourceType("all");
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

          <button 
            className={`${styles.navItem} ${activeTab === "help" ? styles.active : ""}`}
            onClick={() => setActiveTab("help")}
          >
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
            {activeTab === "help" && "Help & Documentation"}
          </h1>
          <div className={styles.topbarRight}>
            <div className="flex items-center gap-3 mr-4">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(139, 115, 85, 0.3)', background: 'rgba(139, 115, 85, 0.05)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: tier === 'pro' ? '#8b7355' : 'rgba(139, 115, 85, 0.4)', boxShadow: tier === 'pro' ? '0 0 8px rgba(139, 115, 85, 0.6)' : 'none' }}></div>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#8b7355', textTransform: 'capitalize', fontFamily: 'Jost, sans-serif' }}>{tier} Plan</span>
                <span style={{ fontSize: '11px', color: '#8b7355', background: 'rgba(139, 115, 85, 0.1)', padding: '2px 8px', borderRadius: '12px', marginLeft: '4px', fontFamily: 'Jost, sans-serif' }}>{credits} Credits</span>
              </div>
              {tier !== 'pro' && (
                <button 
                  onClick={() => setIsPricingModalOpen(true)}
                  style={{
                    background: 'linear-gradient(135deg, rgba(139, 115, 85, 0.9), rgba(110, 90, 65, 0.9))',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    fontFamily: 'Jost, sans-serif',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(139, 115, 85, 0.2)',
                    transition: 'all 0.2s ease',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  Upgrade
                </button>
              )}
            </div>
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
          activeTab !== "alerts" &&
          activeTab !== "help" && (
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
            <AwsConnectForm 
              onScanComplete={handleScanSuccess} 
              onTokenLimit={() => setIsPricingModalOpen(true)}
            />
          </div>
        )}

        <div className={styles.chartGrid}>
          {activeTab === "help" ? (
            <HelpPanel onUpgradeClick={() => setIsPricingModalOpen(true)} />
          ) : activeTab === "logs" ? (
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
                onScanAgain={() => setCostTabScanned(false)}
              />
            )
          )}
        </div>
      </main>
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        onSuccess={(newCredits, newTier) => {
          setCredits(newCredits);
          setTier(newTier);
        }}
      />
    </div>
  );
}
