import { useState } from "react";
import styles from "@/app/src/main_page/page.module.css";
import TabFilters from "@/app/components/TabFilters";

interface Finding {
  id: string;
  inst: string;
  type: string;
  region: string;
  cur: string;
  save: string;
  cpu: string;
  explanation?: string;
  business_impact?: string;
  recommended_action?: string;
  priority?: string;
  metrics?: { suggested_type?: string };
}

interface FindingsPanelProps {
  findings: Finding[];
  dismissed: Set<string>;
  approved: Set<string>;
  selectedFinding: Finding | null;
  activeTab: "all" | "cost" | "security" | "logs" | "alerts";
  onSelectFinding: (finding: Finding | null) => void;
  onApprove: (id: string, actionTypeOverride?: string, targetTypeOverride?: string) => void;
  onDismiss: (id: string, finding: Finding) => void;
  setActiveTab: (tab: "all" | "cost" | "security" | "logs" | "alerts") => void;
  onScanAgain?: () => void;
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
}: FindingsPanelProps) {
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const filteredFindings = findings.filter((f) => {
    if (dismissed.has(f.id)) return false;
    if (regionFilter !== "all" && f.region !== regionFilter && f.region !== "global") return false;
    if (activeTab === "cost")
      return f.type.includes("EC2") || f.type.includes("Volume") || f.type.includes("RDS") || f.type.includes("Scaling") || f.type.includes("VPC");
    if (activeTab === "security") return f.type.includes("S3") || f.type.includes("IAM");
    return true;
  });

  const availableRegions = Array.from(new Set(findings.map(f => f.region).filter(r => r !== "global")));

  const costCount = findings.filter(
    (f) =>
      !dismissed.has(f.id) &&
      (f.type.includes("EC2") || f.type.includes("Volume") || f.type.includes("RDS") || f.type.includes("Scaling") || f.type.includes("VPC"))
  ).length;

  const securityCount = findings.filter(
    (f) => !dismissed.has(f.id) && (f.type.includes("S3") || f.type.includes("IAM"))
  ).length;

  const allCount = findings.filter((f) => !dismissed.has(f.id)).length;

  return (
    <div className={`${styles.largeCard} ${styles.findingsCard}`}>
      <div className={styles.cardHeader} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <h3 style={{ margin: 0 }}>Cloud Resources Requiring Action</h3>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {activeTab === "cost" && (
              <select
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
                  fontFamily: "Jost, sans-serif"
                }}
              >
                <option value="all">All Regions</option>
                {availableRegions.map(r => (
                  <option key={r} value={r}>{r}</option>
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
                  fontFamily: "Jost, sans-serif"
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
              onClick={() => onSelectFinding(f)}
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
                      onClick={() => onApprove(f.id)}
                    >
                      {f.type.includes("Scaling")
                        ? `Scale to ${f.metrics?.suggested_type || "t3.micro"}`
                        : "Approve"}
                    </button>
                    {f.type.includes("EC2") && (
                      <select
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            if (val === "delete") {
                              if (window.confirm("Warning: Are you sure you want to delete this instance? This action cannot be undone.")) {
                                onApprove(f.id, "delete_instance");
                              }
                            } else {
                              onApprove(f.id, "scale_instance", val);
                            }
                            e.target.value = "";
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
                          marginLeft: "8px"
                        }}
                      >
                        <option value="">Auto Scale...</option>
                        <option value="t3.nano">Scale to t3.nano</option>
                        <option value="t3.micro">Scale to t3.micro</option>
                        <option value="t3.medium">Scale to t3.medium</option>
                        <option value="t3.large">Scale to t3.large</option>
                        <option value="t3.xlarge">Scale to t3.xlarge</option>
                        <option value="delete">Delete</option>
                      </select>
                    )}
                    <button
                      className={styles.dismissBtn}
                      onClick={() => onDismiss(f.id, f)}
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
              onClick={() => onSelectFinding(null)}
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
                  <span className={styles.detailValue}>
                    {selectedFinding.region}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Instance Type</span>
                  <span className={styles.detailValue}>
                    {selectedFinding.inst}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Priority</span>
                  <span
                    className={`${styles.detailValue} ${styles[`priority${selectedFinding.priority || "medium"}`]}`}
                  >
                    {selectedFinding.priority?.toUpperCase() || "MEDIUM"}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.detailSection}>
              <h3 className={styles.sectionTitle}>Cost & Impact</h3>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>
                    Current Monthly Cost
                  </span>
                  <span className={styles.detailValue}>{selectedFinding.cur}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>
                    Potential Monthly Savings
                  </span>
                  <span
                    className={`${styles.detailValue} ${styles.savingsValue}`}
                  >
                    {selectedFinding.save}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>CPU Utilization</span>
                  <span className={styles.detailValue}>
                    {selectedFinding.cpu}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.detailSection}>
              <h3 className={styles.sectionTitle}>AI Analysis & Insights</h3>

              {selectedFinding.explanation && (
                <div className={styles.insightBox}>
                  <div className={styles.insightLabel}>Issue Explanation</div>
                  <p className={styles.insightText}>
                    {selectedFinding.explanation}
                  </p>
                </div>
              )}

              {selectedFinding.business_impact && (
                <div className={styles.insightBox}>
                  <div className={styles.insightLabel}>Business Impact</div>
                  <p className={styles.insightText}>
                    {selectedFinding.business_impact}
                  </p>
                </div>
              )}

              {selectedFinding.recommended_action && (
                <div className={styles.insightBox}>
                  <div className={styles.insightLabel}>Recommended Action</div>
                  <p className={styles.insightText}>
                    {selectedFinding.recommended_action}
                  </p>
                </div>
              )}
            </div>

            <div className={styles.detailActions}>
              {approved.has(selectedFinding.id) ? (
                <span className={styles.executingStatus}>⚙ EXECUTING...</span>
              ) : (
                <>
                  <button
                    className={styles.detailApproveBtn}
                    onClick={() => onApprove(selectedFinding.id)}
                  >
                    {selectedFinding.type.includes("Scaling")
                      ? `Approve Rightsizing (${selectedFinding.metrics?.suggested_type || "t3.micro"})`
                      : "Approve & Execute"}
                  </button>
                  <button
                    className={styles.detailDismissBtn}
                    onClick={() => onDismiss(selectedFinding.id, selectedFinding)}
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
  );
}
