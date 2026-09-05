"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ShieldAlert,
} from "lucide-react";
import { api, devLog, devError, extractErrorMessage, networkErrorMessage } from "@/app/lib/config";
import {
  getPreferredRegion,
  loadEncryptedCredentials,
  setPreferredRegion,
} from "@/app/lib/credentials";
import { sumSavings } from "@/app/lib/format";
import type {
  ActionRecord,
  AlertConfig,
  DashboardTab,
  Finding,
  TriggeredAlert,
} from "@/app/lib/types";
import "../landing_page/index.css";
import styles from "./page.module.css";

const TAB_TITLES: Record<DashboardTab, string> = {
  all: "Cloud Resource Overview",
  cost: "Cost Explorer",
  security: "Security Findings",
  logs: "Previous Actions & Logs",
  alerts: "Alert Configuration & History",
  help: "Help & Documentation",
};

/**
 * Map a finding to the remediation the backend should run.
 *
 * Order matters: "Scaling Candidate (EC2)" also contains "EC2", so the more
 * specific issue types are checked first.
 */
function defaultActionFor(finding: Finding): string {
  const type = finding.type || "";
  if (type.includes("Volume")) return "delete_volume";
  if (type.includes("S3")) return "secure_s3";
  if (type.includes("Scaling")) return "scale_instance";
  // Stopping an idle database is reversible; deleting it is not.
  if (type.includes("RDS")) return "stop_rds";
  if (type.includes("VPC")) return "delete_vpc";
  return "stop_instance";
}

export default function MainPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [findings, setFindings] = useState<Finding[]>([]);
  const [approved, setApproved] = useState(new Set<string>());
  const [dismissed, setDismissed] = useState(new Set<string>());
  const [activeTab, setActiveTab] = useState<DashboardTab>("all");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [showAwsForm, setShowAwsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanningResource, setScanningResource] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<ActionRecord[]>([]);
  const [costTabScanned, setCostTabScanned] = useState(false);

  const [tier, setTier] = useState<string>("free");
  const [credits, setCredits] = useState<number>(0);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const [alertConfigs, setAlertConfigs] = useState<AlertConfig[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);
  const [pendingAlerts, setPendingAlerts] = useState<TriggeredAlert[]>([]);

  // Bumped explicitly instead of keying the loader on `activeTab`, which
  // refetched the whole profile on every sidebar click.
  const [dataVersion, setDataVersion] = useState(0);
  const notifiedAlertIds = useRef(new Set<string>());

  useEffect(() => {
    if (!loading && !user) router.replace("/src/login_page");
  }, [user, loading, router]);

  const authHeaders = useCallback(async () => {
    if (!user) return null;
    const token = await user.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const loadUserData = async () => {
      const headers = await authHeaders();
      if (!headers) return;

      try {
        const [syncRes, alertsRes, logsRes, triggeredRes] = await Promise.all([
          fetch(api.endpoints.userSync, { method: "POST", headers }).catch(() => null),
          fetch(api.endpoints.alertsConfig, { headers }).catch(() => null),
          fetch(api.endpoints.actionLogs, { headers }).catch(() => null),
          fetch(api.endpoints.alertsTriggered, { headers }).catch(() => null),
        ]);
        if (cancelled) return;

        if (syncRes?.ok) {
          const syncData = await syncRes.json();
          setTier(syncData.tier ?? "free");
          setCredits(syncData.credits ?? 0);
        } else if (syncRes) {
          setError(
            await extractErrorMessage(syncRes, "Could not load your profile. Some features may be unavailable."),
          );
        }

        if (alertsRes?.ok) {
          const alertsData = await alertsRes.json();
          setAlertConfigs(alertsData.configs ?? []);
        }

        if (logsRes?.ok) {
          const logsData = await logsRes.json();
          setActionHistory(
            (logsData.logs ?? []).map((log: Record<string, string>) => ({
              id: log.id,
              resourceId: log.resource_id,
              action: log.action,
              type: log.type,
              timestamp: log.timestamp,
            })),
          );
        }

        if (triggeredRes?.ok) {
          const triggeredData = await triggeredRes.json();
          setTriggeredAlerts(triggeredData.alerts ?? []);
        }
      } catch (err) {
        if (!cancelled) devError("Failed to load user data:", err);
      }
    };

    loadUserData();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, dataVersion]);

  const activeFindings = useMemo(
    () => findings.filter((f) => !dismissed.has(f.uid)),
    [findings, dismissed],
  );

  const totalSavings = useMemo(() => sumSavings(activeFindings), [activeFindings]);

  /**
   * Alerts the client evaluated locally, merged with the server's history.
   *
   * The worker result used to replace `triggeredAlerts` outright, which wiped
   * the persisted history from `/api/alerts/triggered` and left the Alerts tab
   * empty whenever there were no current findings.
   */
  const visibleAlerts = useMemo(() => {
    // Locally evaluated alerts only apply while there are findings and
    // thresholds to compare them against.
    const localAlerts =
      findings.length > 0 && alertConfigs.length > 0 ? pendingAlerts : [];
    const seen = new Set(triggeredAlerts.map((a) => `${a.configId}-${a.resourceId}`));
    const merged = [...triggeredAlerts];
    localAlerts.forEach((alert) => {
      const key = `${alert.configId}-${alert.resourceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(alert);
      }
    });
    return merged;
  }, [triggeredAlerts, pendingAlerts, findings.length, alertConfigs.length]);

  // Read inside the worker effect without making `dismissed` a dependency,
  // which would re-run the evaluation on every dismissal.
  const dismissedRef = useRef(dismissed);
  useEffect(() => {
    dismissedRef.current = dismissed;
  }, [dismissed]);

  // Evaluate alerts when the findings or the thresholds change -- deliberately
  // not when a row is dismissed, which used to re-post to the backend and add
  // duplicate history rows on every click.
  useEffect(() => {
    if (alertConfigs.length === 0 || findings.length === 0) return;

    const worker = new Worker(new URL("../../workers/alertWorker.ts", import.meta.url));

    worker.onmessage = (event) => {
      const newAlerts: TriggeredAlert[] = event.data ?? [];
      setPendingAlerts(newAlerts);

      newAlerts.forEach((alert) => {
        const key = String(alert.id);
        if (notifiedAlertIds.current.has(key)) return;
        notifiedAlertIds.current.add(key);

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification("Tuff alert triggered", {
            body: `${alert.resourceId} (${alert.resourceType}) crossed your ${alert.metric} threshold.`,
            icon: "/favicon.ico",
          });
        }
      });
    };

    worker.postMessage({
      alertConfigs,
      findings,
      dismissedList: Array.from(dismissedRef.current),
    });

    const evaluateOnServer = async () => {
      const headers = await authHeaders();
      if (!headers) return;
      try {
        // Only the findings are sent: the backend reads the thresholds from the
        // database so a client cannot evaluate against someone else's alerts.
        const res = await fetch(api.endpoints.alertsEvaluate, {
          method: "POST",
          headers,
          body: JSON.stringify({ findings }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.alerts?.length) {
            setTriggeredAlerts((prev) => [...data.alerts, ...prev]);
          }
        }
      } catch (err) {
        devLog("Backend alert evaluation unavailable:", err);
      }
    };
    evaluateOnServer();

    return () => worker.terminate();
  }, [findings, alertConfigs, authHeaders]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleScanSuccess = useCallback(
    (liveData: Finding[], credentials?: { region: string }) => {
      setFindings(liveData);
      if (credentials?.region) setPreferredRegion(credentials.region);
      setApproved(new Set());
      setDismissed(new Set());
      setSelectedFinding(liveData.length > 0 ? liveData[0] : null);
      setCostTabScanned(true);
      setShowAwsForm(false);
      setNotice(
        liveData.length > 0
          ? `Scan complete — ${liveData.length} finding(s) need review.`
          : "Scan complete — no waste or exposure detected.",
      );
    },
    [],
  );

  const handleApprove = async (
    uid: string,
    actionTypeOverride?: string,
    targetTypeOverride?: string,
  ) => {
    const targetFinding = findings.find((f) => f.uid === uid);
    if (!targetFinding) return;

    const headers = await authHeaders();
    if (!headers || !user) {
      setError("Your session expired. Please sign in again.");
      return;
    }

    // Credentials are read from the encrypted session store rather than from
    // component state, so remediation keeps working after a page reload
    // instead of silently sending placeholder keys to AWS.
    const stored = loadEncryptedCredentials(user.uid);
    if (!stored) {
      setError("Connect your AWS account before approving an action.");
      setShowAwsForm(true);
      return;
    }

    const actionType = actionTypeOverride || defaultActionFor(targetFinding);
    setError(null);
    setApproved((prev) => new Set(prev).add(uid));

    const revertApproval = () =>
      setApproved((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });

    try {
      const response = await fetch(api.endpoints.execute, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aws_access_key: stored.accessKey,
          aws_secret_key: stored.secretKey,
          region:
            targetFinding.region && targetFinding.region !== "global"
              ? targetFinding.region
              : stored.region || getPreferredRegion(),
          resource_id: targetFinding.id,
          action_type: actionType,
          target_type:
            actionType === "scale_instance"
              ? targetTypeOverride || targetFinding.metrics?.suggested_type || "t3.micro"
              : undefined,
        }),
      });

      if (!response.ok) {
        setError(await extractErrorMessage(response, "Failed to execute that action."));
        revertApproval();
        return;
      }

      const result = await response.json();
      setNotice(result.message || "Action completed.");

      try {
        const res = await fetch(api.endpoints.actionLogs, {
          method: "POST",
          headers,
          body: JSON.stringify({
            resource_id: targetFinding.id,
            action: "Approved",
            resource_type: targetFinding.type,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setActionHistory((prev) => [
            {
              id: data.log_id,
              resourceId: targetFinding.id,
              action: "Approved",
              type: targetFinding.type,
              timestamp: data.timestamp,
            },
            ...prev,
          ]);
        }
      } catch {
        devLog("Could not record the action log entry");
      }

      setDismissed((prev) => new Set(prev).add(uid));
      setSelectedFinding((prev) => (prev?.uid === uid ? null : prev));
    } catch (err) {
      devError("Remediation request failed", err);
      setError(networkErrorMessage());
      revertApproval();
    }
  };

  const handleScanResourceType = async (resourceType: string, regionOverride?: string) => {
    const headers = await authHeaders();
    if (!headers || !user) {
      setError("Your session expired. Please sign in again.");
      return;
    }

    const stored = loadEncryptedCredentials(user.uid);
    if (!stored) {
      setError("Connect your AWS account first, then run a scan.");
      setShowAwsForm(true);
      return;
    }

    setScanningResource(resourceType);
    setError(null);

    const targetRegion = regionOverride || stored.region || getPreferredRegion();

    try {
      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aws_access_key: stored.accessKey,
          aws_secret_key: stored.secretKey,
          region: targetRegion,
        }),
      });

      if (!response.ok) {
        if (response.status === 429 || response.status === 402) {
          setIsPricingModalOpen(true);
          return;
        }
        setError(await extractErrorMessage(response, `Failed to scan ${resourceType} resources.`));
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data?.data)) {
        setError("The server returned an unexpected response.");
        return;
      }

      if (typeof data.credits_remaining === "number") setCredits(data.credits_remaining);

      const all: Finding[] = data.data;
      if (resourceType === "all") {
        handleScanSuccess(all, { region: targetRegion });
        return;
      }

      const filtered = all.filter((f) =>
        f.type.toLowerCase().includes(resourceType.toLowerCase()),
      );
      handleScanSuccess(filtered, { region: targetRegion });
      if (filtered.length === 0 && all.length > 0) {
        // Previously the full result set was substituted here, which silently
        // showed unrelated resources under a specific resource filter.
        setNotice(
          `No ${resourceType} findings. Tuff found ${all.length} finding(s) in other resource types — switch to "All Resources" to see them.`,
        );
      }
    } catch (err) {
      devError("Scan request failed", err);
      setError(networkErrorMessage());
    } finally {
      setScanningResource(null);
    }
  };

  const handleAddAlert = async (alertData: Omit<AlertConfig, "id">) => {
    const headers = await authHeaders();
    if (!headers) {
      setError("Your session expired. Please sign in again.");
      return;
    }

    if (!Number.isFinite(alertData.threshold)) {
      setError("Please enter a numeric threshold value.");
      return;
    }

    try {
      const res = await fetch(api.endpoints.alertsConfig, {
        method: "POST",
        headers,
        body: JSON.stringify(alertData),
      });

      if (!res.ok) {
        setError(await extractErrorMessage(res, "Failed to save the alert."));
        return;
      }

      const data = await res.json();
      setAlertConfigs((prev) => [{ ...alertData, id: data.alert.id }, ...prev]);
      setError(null);
      setNotice("Alert created.");

      // Asked here, in response to a deliberate action, rather than on page
      // load where browsers ignore or penalise the prompt.
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }
    } catch (err) {
      devError("Alert creation failed", err);
      setError(networkErrorMessage());
    }
  };

  const handleRemoveAlert = async (alertId: string) => {
    const previous = alertConfigs;
    setAlertConfigs((prev) => prev.filter((a) => a.id !== alertId));

    const headers = await authHeaders();
    if (!headers) return;

    try {
      const res = await fetch(`${api.endpoints.alertsConfig}/${alertId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        // Put the row back rather than leaving the UI out of step with the server.
        setAlertConfigs(previous);
        setError(await extractErrorMessage(res, "Could not remove that alert."));
      }
    } catch (err) {
      setAlertConfigs(previous);
      devError("Alert removal failed", err);
      setError(networkErrorMessage());
    }
  };

  const handleDismissWithHistory = async (uid: string, finding: Finding) => {
    setDismissed((prev) => new Set(prev).add(uid));
    setSelectedFinding((prev) => (prev?.uid === uid ? null : prev));

    const headers = await authHeaders();
    if (!headers) return;

    try {
      const res = await fetch(api.endpoints.actionLogs, {
        method: "POST",
        headers,
        body: JSON.stringify({
          resource_id: finding.id,
          action: "Dismissed",
          resource_type: finding.type,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionHistory((prev) => [
          {
            id: data.log_id,
            resourceId: finding.id,
            action: "Dismissed",
            type: finding.type,
            timestamp: data.timestamp,
          },
          ...prev,
        ]);
      }
    } catch {
      devLog("Could not record the dismissal");
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/src/login_page");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out.");
    }
  };

  const handleStartScan = () => {
    if (!user || !loadEncryptedCredentials(user.uid)) {
      setError("AWS credentials are not configured for this session. Connect your account first.");
      setShowAwsForm(true);
      return;
    }
    setActiveTab("cost");
    setCostTabScanned(false);
  };

  if (loading || !user) {
    return (
      <div className={styles.loadingContainer} role="status" aria-live="polite">
        Loading your secure operations console…
      </div>
    );
  }

  const navItems: Array<{ tab: DashboardTab; label: string; icon: React.ReactNode }> = [
    { tab: "all", label: "Overview", icon: <Home size={18} /> },
    { tab: "cost", label: "Cost Explorer", icon: <Wallet size={18} /> },
    { tab: "security", label: "Security", icon: <ShieldAlert size={18} /> },
    { tab: "logs", label: "Logs", icon: <BarChart3 size={18} /> },
    { tab: "alerts", label: "Alerts", icon: <Bell size={18} /> },
  ];

  const showStats = activeTab === "all" || activeTab === "security";

  return (
    <div className={styles.dashboardLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <span className={styles.logoText}>Tuff</span>
          <span className={styles.logoSubtext}>{"// console"}</span>
        </div>

        <nav className={styles.navLinks} aria-label="Dashboard sections">
          {navItems.map((item) => (
            <button
              key={item.tab}
              type="button"
              className={
                activeTab === item.tab
                  ? `${styles.navItem} ${styles.navItemActive}`
                  : styles.navItem
              }
              onClick={() => setActiveTab(item.tab)}
              aria-current={activeTab === item.tab ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarActions}>
          <button type="button" className={styles.navItem} onClick={handleStartScan}>
            <FileText size={18} />
            <span>Scan Resources</span>
          </button>

          <button
            type="button"
            className={styles.connectAwsBtn}
            onClick={() => setShowAwsForm((prev) => !prev)}
            aria-expanded={showAwsForm}
          >
            <Wallet size={18} />
            <span>{showAwsForm ? "Hide AWS Settings" : "Connect AWS Account"}</span>
          </button>

          <button
            type="button"
            className={
              activeTab === "help"
                ? `${styles.navItem} ${styles.navItemActive}`
                : styles.navItem
            }
            onClick={() => setActiveTab("help")}
          >
            <HelpCircle size={18} />
            <span>Help</span>
          </button>

          <button type="button" onClick={handleLogout} className={styles.logoutItem}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>

        <div className={styles.userCard}>
          <div className={styles.avatar}>{user.email?.[0]?.toUpperCase() ?? "?"}</div>
          <div className={styles.userMeta}>
            <h4>{user.email?.split("@")[0]}</h4>
            <p>{user.email}</p>
          </div>
        </div>
      </aside>

      <main className={styles.mainContent}>
        <div className={styles.topbar}>
          <h1>{TAB_TITLES[activeTab]}</h1>
          <div className={styles.topbarRight}>
            <div className="flex items-center gap-3 mr-4">
              <div
                title={`${credits} AI credits remaining`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: "1px solid rgba(139, 115, 85, 0.3)",
                  background: "rgba(139, 115, 85, 0.05)",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: tier === "pro" ? "#8b7355" : "rgba(139, 115, 85, 0.4)",
                    boxShadow: tier === "pro" ? "0 0 8px rgba(139, 115, 85, 0.6)" : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#8b7355",
                    textTransform: "capitalize",
                    fontFamily: "Jost, sans-serif",
                  }}
                >
                  {tier} Plan
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#8b7355",
                    background: "rgba(139, 115, 85, 0.1)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    marginLeft: "4px",
                    fontFamily: "Jost, sans-serif",
                  }}
                >
                  {credits.toLocaleString()} Credits
                </span>
              </div>
              {tier !== "pro" && (
                <button
                  onClick={() => setIsPricingModalOpen(true)}
                  style={{
                    background: "linear-gradient(135deg, rgba(139, 115, 85, 0.9), rgba(110, 90, 65, 0.9))",
                    color: "#fff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily: "Jost, sans-serif",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(139, 115, 85, 0.2)",
                    transition: "all 0.2s ease",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
                  onMouseOut={(e) => (e.currentTarget.style.transform = "translateY(0)")}
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <div className={styles.errorContent}>
              <span className={styles.errorIcon}>⚠</span>
              <span className={styles.errorMessage}>{error}</span>
            </div>
            <button className={styles.errorClose} onClick={() => setError(null)} aria-label="Dismiss error">
              ✕
            </button>
          </div>
        )}

        {notice && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              margin: "0 0 20px",
              padding: "12px 16px",
              borderRadius: "8px",
              background: "rgba(100, 140, 80, 0.1)",
              border: "1px solid rgba(100, 140, 80, 0.35)",
              color: "#41632f",
              fontFamily: "Jost, sans-serif",
              fontSize: "14px",
            }}
          >
            <span>{notice}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss message"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#41632f", fontSize: "14px" }}
            >
              ✕
            </button>
          </div>
        )}

        {showStats && (
          <StatsPanel
            findings={findings}
            dismissed={dismissed}
            totalSavings={totalSavings}
            approved={approved}
            alertConfigs={alertConfigs}
            triggeredAlerts={visibleAlerts}
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
              <button className={styles.closeBtn} onClick={() => setShowAwsForm(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <AwsConnectForm
              onScanComplete={handleScanSuccess}
              onTokenLimit={() => setIsPricingModalOpen(true)}
              onCreditsChange={setCredits}
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
              triggeredAlerts={visibleAlerts}
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
                onUpgradeClick={() => setIsPricingModalOpen(true)}
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
          setNotice("You're on Tuff Pro. Enjoy your extra AI credits.");
          setDataVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
