import { useEffect, useMemo, useState } from "react";
import styles from "@/app/src/main_page/page.module.css";
import TabFilters from "@/app/components/TabFilters";
import { useAuth } from "@/app/context/AuthContext";
import { api, extractErrorMessage, networkErrorMessage } from "@/app/lib/config";
import type { DashboardTab, Finding } from "@/app/lib/types";

interface FindingsPanelProps {
  findings: Finding[];
  dismissed: Set<string>;
  approved: Set<string>;
  selectedFinding: Finding | null;
  activeTab: DashboardTab;
  onSelectFinding: (finding: Finding | null) => void;
  onApprove: (uid: string, actionTypeOverride?: string, targetTypeOverride?: string) => void;
  onDismiss: (uid: string, finding: Finding) => void;
  setActiveTab: (tab: DashboardTab) => void;
  onScanAgain?: () => void;
  onUpgradeClick?: () => void;
}

const COST_TYPES = ["EC2", "Volume", "RDS", "Scaling", "VPC"];
const SECURITY_TYPES = ["S3", "IAM"];

function isCostFinding(finding: Finding): boolean {
  return COST_TYPES.some((t) => finding.type.includes(t));
}

function isSecurityFinding(finding: Finding): boolean {
  return SECURITY_TYPES.some((t) => finding.type.includes(t));
}

/** Human-readable description of what approving a finding will actually do. */
function actionSummary(finding: Finding): string {
  const type = finding.type;
  if (type.includes("Volume")) return `permanently delete volume ${finding.id}`;
  if (type.includes("S3")) return `block all public access on bucket ${finding.id}`;
  if (type.includes("Scaling"))
    return `stop ${finding.id}, resize it to ${finding.metrics?.suggested_type ?? "t3.micro"}, and start it again`;
  if (type.includes("RDS")) return `stop database ${finding.id}`;
  if (type.includes("VPC")) return `delete VPC ${finding.id}`;
  return `stop instance ${finding.id}`;
}

function isDestructive(finding: Finding): boolean {
  return ["Volume", "VPC"].some((t) => finding.type.includes(t));
}

export default function FindingsPanel({
  findings,
  dismissed,
  approved,
  selectedFinding,
  activeTab,
  onSelectFinding,
  onApprove,
  onDismiss,
  setActiveTab,
  onScanAgain,
  onUpgradeClick,
}: FindingsPanelProps) {
  const { user } = useAuth();
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [confirmation, setConfirmation] = useState<{
    finding: Finding;
    actionType?: string;
    targetType?: string;
    message: string;
  } | null>(null);
  const [humanizedText, setHumanizedText] = useState<string | null>(null);
  const [isHumanizing, setIsHumanizing] = useState(false);

  // Close the confirmation dialog with Escape, which users expect of any modal.
  useEffect(() => {
    if (!confirmation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmation(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmation]);

  const handleSelectFinding = (finding: Finding | null) => {
    setHumanizedText(null);
    onSelectFinding(finding);
  };

  const handleHumanize = async () => {
    if (!selectedFinding || !user) return;
    setIsHumanizing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(api.endpoints.humanize, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          explanation: selectedFinding.explanation || "",
          business_impact: selectedFinding.business_impact || "",
          recommended_action: selectedFinding.recommended_action || "",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setHumanizedText(data.humanized_text);
      } else {
        setHumanizedText(await extractErrorMessage(res, "Could not generate a plain-English summary."));
      }
    } catch {
      setHumanizedText(networkErrorMessage());
    } finally {
      setIsHumanizing(false);
    }
  };

  const visibleFindings = useMemo(
    () => findings.filter((f) => !dismissed.has(f.uid)),
    [findings, dismissed],
  );

  const filteredFindings = useMemo(
    () =>
      visibleFindings.filter((f) => {
        if (regionFilter !== "all" && f.region !== regionFilter && f.region !== "global") return false;
        if (activeTab === "cost") return isCostFinding(f);
        if (activeTab === "security") return isSecurityFinding(f);
        return true;
      }),
    [visibleFindings, regionFilter, activeTab],
  );

  const availableRegions = useMemo(
    () => Array.from(new Set(findings.map((f) => f.region).filter((r) => r && r !== "global"))),
    [findings],
  );

  const costCount = visibleFindings.filter(isCostFinding).length;
  const securityCount = visibleFindings.filter(isSecurityFinding).length;
  const allCount = visibleFindings.length;

  const requestApproval = (finding: Finding, actionType?: string, targetType?: string) => {
    const message = actionType === "delete_instance"
      ? `Terminate instance ${finding.id}? This is irreversible and all data on its instance store will be lost.`
      : `Tuff will ${actionSummary(finding)}. Continue?`;

    // Anything irreversible is confirmed first. Reversible actions (stopping an
    // instance, blocking public access) run straight away.
    if (actionType === "delete_instance" || isDestructive(finding)) {
      setConfirmation({ finding, actionType, targetType, message });
      return;
    }
    onApprove(finding.uid, actionType, targetType);
  };

  return (
    <div className={`${styles.largeCard} ${styles.findingsCard}`}>
      <div className={styles.cardHeader} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <h3 style={{ margin: 0 }}>Cloud Resources Requiring Action</h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {availableRegions.length > 1 && (
              <select
                aria-label="Filter by region"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                style={{
                  background: "rgba(255, 255, 255, 0.95)",
                  border: "1px solid #8b7355",
                  padding: "6px 12px",
                  color: "#000000",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                  outline: "none",
                  fontFamily: "Jost, sans-serif",
                }}
              >
                <option value="all">All Regions</option>
                {availableRegions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {activeTab === "cost" && onScanAgain && (
              <button
                onClick={onScanAgain}
                style={{
                  background: "#8b7355",
                  color: "#ffffff",
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  fontFamily: "Jost, sans-serif",
                }}
              >
                Scan Again
              </button>
            )}
          </div>
        </div>
        <TabFilters
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          allCount={allCount}
          costCount={costCount}
          securityCount={securityCount}
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
            No scan results yet. Connect an AWS account and run a scan to see findings here.
          </div>
        ) : filteredFindings.length === 0 ? (
          <div className={styles.emptyStateFiltered}>
            Nothing matches the current filter.
          </div>
        ) : (
          filteredFindings.map((f) => (
            // Keyed by `uid`: one resource can raise several findings, so the
            // resource id alone produced duplicate React keys and made
            // approving one row mark its sibling as executing too.
            <div
              key={f.uid}
              className={styles.findingRow}
              onClick={() => handleSelectFinding(f)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectFinding(f);
                }
              }}
              aria-label={`${f.type} on ${f.id}`}
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
              <div className={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                {approved.has(f.uid) ? (
                  <span className={styles.executingStatus}>⚙ EXECUTING...</span>
                ) : (
                  <>
                    <button
                      className={styles.approveBtn}
                      onClick={() => requestApproval(f)}
                      title={`Tuff will ${actionSummary(f)}`}
                    >
                      {f.type.includes("Scaling")
                        ? `Scale to ${f.metrics?.suggested_type || "t3.micro"}`
                        : "Approve"}
                    </button>
                    {f.type.includes("EC2") && (
                      <select
                        aria-label={`Choose another action for ${f.id}`}
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          e.target.value = "";
                          if (!val) return;
                          if (val === "delete") {
                            requestApproval(f, "delete_instance");
                          } else {
                            requestApproval(f, "scale_instance", val);
                          }
                        }}
                        style={{
                          background: "rgba(139, 115, 85, 0.1)",
                          color: "#8b7355",
                          border: "1px solid rgba(139, 115, 85, 0.3)",
                          padding: "6px 10px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          outline: "none",
                          fontFamily: "Jost, sans-serif",
                          marginLeft: "8px",
                        }}
                      >
                        <option value="">More actions…</option>
                        <option value="t3.nano">Resize to t3.nano</option>
                        <option value="t3.micro">Resize to t3.micro</option>
                        <option value="t3.small">Resize to t3.small</option>
                        <option value="t3.medium">Resize to t3.medium</option>
                        <option value="t3.large">Resize to t3.large</option>
                        <option value="delete">Terminate instance</option>
                      </select>
                    )}
                    <button
                      className={styles.dismissBtn}
                      onClick={() => onDismiss(f.uid, f)}
                      aria-label={`Dismiss finding for ${f.id}`}
                      title="Dismiss this finding"
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
              onClick={() => handleSelectFinding(null)}
              aria-label="Close detail panel"
            >
              ✕
            </button>
          </div>

          <div className={styles.detailContent}>
            {selectedFinding.requires_upgrade && (
              <div
                className={styles.insightBox}
                style={{ background: "rgba(139, 115, 85, 0.08)", border: "1px solid #8b7355" }}
              >
                <div className={styles.insightLabel}>AI analysis not run</div>
                <p className={styles.insightText}>
                  You reached your free credit limit before Tuff could analyse this finding.
                </p>
                {onUpgradeClick && (
                  <button
                    onClick={onUpgradeClick}
                    style={{
                      marginTop: "8px",
                      background: "#8b7355",
                      color: "#fff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontFamily: "Jost, sans-serif",
                    }}
                  >
                    Upgrade to Pro
                  </button>
                )}
              </div>
            )}

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
                  <span
                    className={`${styles.detailValue} ${styles[`priority${selectedFinding.priority || "medium"}`]}`}
                  >
                    {(selectedFinding.priority || "medium").toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.detailSection}>
              <h3 className={styles.sectionTitle}>Cost & Impact</h3>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Estimated Monthly Cost</span>
                  <span className={styles.detailValue}>{selectedFinding.cur}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Potential Monthly Savings</span>
                  <span className={`${styles.detailValue} ${styles.savingsValue}`}>
                    {selectedFinding.save}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>CPU Utilization</span>
                  <span className={styles.detailValue}>{selectedFinding.cpu}</span>
                </div>
              </div>
              <p style={{ fontSize: "11px", color: "#8b7355", marginTop: "8px" }}>
                Costs are on-demand list-price estimates and exclude Savings Plans, Reserved
                Instances and data transfer.
              </p>
            </div>

            <div className={styles.detailSection}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                  AI Analysis & Insights
                </h3>
                <button
                  onClick={handleHumanize}
                  disabled={isHumanizing}
                  style={{
                    background: "#8b7355",
                    color: "#fff",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    cursor: isHumanizing ? "not-allowed" : "pointer",
                    fontSize: "12px",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    fontFamily: "Jost, sans-serif",
                  }}
                >
                  {isHumanizing ? "Explaining…" : "Explain simply"}
                </button>
              </div>

              {humanizedText && (
                <div
                  className={styles.insightBox}
                  style={{ background: "rgba(100, 140, 80, 0.1)", border: "1px solid #648c50" }}
                >
                  <div className={styles.insightLabel} style={{ color: "#648c50" }}>
                    Plain English Summary
                  </div>
                  <p className={styles.insightText}>{humanizedText}</p>
                </div>
              )}

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
              {approved.has(selectedFinding.uid) ? (
                <span className={styles.executingStatus}>⚙ EXECUTING...</span>
              ) : (
                <>
                  <button
                    className={styles.detailApproveBtn}
                    onClick={() => requestApproval(selectedFinding)}
                    title={`Tuff will ${actionSummary(selectedFinding)}`}
                  >
                    {selectedFinding.type.includes("Scaling")
                      ? `Approve Rightsizing (${selectedFinding.metrics?.suggested_type || "t3.micro"})`
                      : "Approve & Execute"}
                  </button>
                  <button
                    className={styles.detailDismissBtn}
                    onClick={() => onDismiss(selectedFinding.uid, selectedFinding)}
                  >
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setConfirmation(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#f9f7f4",
              border: "1px solid rgba(139, 115, 85, 0.3)",
              borderRadius: "12px",
              padding: "32px",
              maxWidth: "440px",
              textAlign: "center",
              boxShadow: "0 20px 40px rgba(139, 115, 85, 0.15)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              fontFamily: "Jost, sans-serif",
            }}
          >
            <h3 id="confirm-title" style={{ color: "#d43a2a", margin: 0, fontSize: "1.4rem", fontWeight: 600 }}>
              Confirm action
            </h3>
            <p style={{ color: "#3d3d3d", margin: 0, fontSize: "1rem", lineHeight: 1.6 }}>
              {confirmation.message}
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "8px" }}>
              <button
                onClick={() => setConfirmation(null)}
                style={{
                  padding: "10px 20px",
                  background: "rgba(139, 115, 85, 0.05)",
                  border: "1px solid rgba(139, 115, 85, 0.2)",
                  color: "#8b7355",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => {
                  onApprove(
                    confirmation.finding.uid,
                    confirmation.actionType,
                    confirmation.targetType,
                  );
                  setConfirmation(null);
                }}
                style={{
                  padding: "10px 20px",
                  background: "#d43a2a",
                  border: "none",
                  color: "#fff",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
