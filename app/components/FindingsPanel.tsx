import { useState } from "react";
import styles from "@/app/src/main_page/page.module.css";
import TabFilters from "@/app/components/TabFilters";
import { useAuth } from "@/app/context/AuthContext";
import { api } from "@/app/lib/config";

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
  const { user } = useAuth();
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [humanizedText, setHumanizedText] = useState<string | null>(null);
  const [isHumanizing, setIsHumanizing] = useState(false);

  const handleSelectFinding = (finding: Finding | null) => {
    setHumanizedText(null);
    onSelectFinding(finding);
  };

  const handleHumanize = async () => {
    if (!selectedFinding || !user) return;
    setIsHumanizing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${api.baseURL}/api/humanize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          explanation: selectedFinding.explanation || "",
          business_impact: selectedFinding.business_impact || "",
          recommended_action: selectedFinding.recommended_action || ""
        })
      });
      if (res.ok) {
        const data = await res.json();
        setHumanizedText(data.humanized_text);
      } else {
        setHumanizedText("Failed to humanize the finding.");
      }
    } catch (e) {
      setHumanizedText("An error occurred while humanizing.");
    } finally {
      setIsHumanizing(false);
    }
  };

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
          Object.entries(
            filteredFindings.reduce((acc, finding) => {
              if (!acc[finding.id]) {
                acc[finding.id] = [];
              }
              acc[finding.id].push(finding);
              return acc;
            }, {} as Record<string, Finding[]>)
          ).map(([id, group]) => (
            <div key={id} className={styles.findingGroupBlock}>
              {group.map((f, index) => (
                <div
                  key={`${f.id}-${index}`}
                  className={styles.findingRow}
                  onClick={() => handleSelectFinding(f)}
                >
                  <div className={styles.findingIdWrapper}>
                    {index === 0 && (
                      <>
                        <div className={styles.findingId}>{f.id}</div>
                        <div className={styles.findingInst}>{f.inst}</div>
                      </>
                    )}
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
                                  setConfirmDeleteId(f.id);
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
                              marginLeft: "8px",
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
              ))}
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
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
                <h3 className={styles.sectionTitle} style={{margin: 0}}>AI Analysis & Insights</h3>
                <button
                  onClick={handleHumanize}
                  disabled={isHumanizing}
                  style={{
                    background: "#8b7355", color: "#fff", border: "none", padding: "6px 12px", 
                    borderRadius: "4px", cursor: isHumanizing ? "not-allowed" : "pointer",
                    fontSize: "12px", fontWeight: "bold", textTransform: "uppercase",
                    fontFamily: "Jost, sans-serif"
                  }}
                >
                  {isHumanizing ? "Humanizing..." : "Humanize"}
                </button>
              </div>

              {humanizedText && (
                <div className={styles.insightBox} style={{ background: "rgba(100, 140, 80, 0.1)", border: "1px solid #648c50" }}>
                  <div className={styles.insightLabel} style={{ color: "#648c50" }}>Plain English Summary</div>
                  <p className={styles.insightText}>{humanizedText}</p>
                </div>
              )}

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

      {/* Custom Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999
        }} onClick={() => setConfirmDeleteId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#f9f7f4", border: "1px solid rgba(139, 115, 85, 0.3)",
            borderRadius: "12px", padding: "32px", maxWidth: "420px",
            textAlign: "center", boxShadow: "0 20px 40px rgba(139, 115, 85, 0.15)",
            display: "flex", flexDirection: "column", gap: "16px",
            fontFamily: "Jost, sans-serif"
          }}>
            <h3 style={{ color: "#d43a2a", margin: 0, fontSize: "1.4rem", fontWeight: 600 }}>Confirm Deletion</h3>
            <p style={{ color: "#3d3d3d", margin: 0, fontSize: "1rem", lineHeight: "1.6" }}>
              Are you absolutely sure you want to terminate this instance? This action is irreversible and all local data will be permanently destroyed.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "16px" }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: "10px 20px", background: "rgba(139, 115, 85, 0.05)", border: "1px solid rgba(139, 115, 85, 0.2)",
                  color: "#8b7355", borderRadius: "6px", cursor: "pointer", fontWeight: 600, transition: "background 0.2s"
                }}
                onMouseOver={(e) => e.currentTarget.style.background = "rgba(139, 115, 85, 0.1)"}
                onMouseOut={(e) => e.currentTarget.style.background = "rgba(139, 115, 85, 0.05)"}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onApprove(confirmDeleteId, "delete_instance");
                  setConfirmDeleteId(null);
                }}
                style={{
                  padding: "10px 20px", background: "#d43a2a", border: "none",
                  color: "#fff", borderRadius: "6px", cursor: "pointer", fontWeight: 600, transition: "background 0.2s"
                }}
                onMouseOver={(e) => e.currentTarget.style.background = "#b92b1d"}
                onMouseOut={(e) => e.currentTarget.style.background = "#d43a2a"}
              >
                Yes, Terminate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
