"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import AwsConnectForm from "@/app/components/AwsConnectForm";
import MetricsPanel from "@/app/components/MetricPanel";
import TabFilters from "@/app/components/TabFilters";
import CodeDrawer from "@/app/components/CodeDrawer";
import "../landing_page/index.css";

export default function MainPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [findings, setFindings] = useState<any[]>([]);
  const [approved, setApproved] = useState(new Set<string>());
  const [dismissed, setDismissed] = useState(new Set<string>());
  const [activeTab, setActiveTab] = useState<"all" | "cost" | "security">(
    "all",
  );
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);

  const [totalSavings, setTotalSavings] = useState(0);
  const [zombiesCount, setZombiesCount] = useState(0);

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

  if (loading || !user) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
          background: "#000",
          color: "#ede0ce",
          fontFamily: "monospace",
        }}
      >
        LOADING SECURE OPERATIONS CELL...
      </div>
    );
  }

  const handleScanSuccess = (liveData: any[]) => {
    setFindings(liveData);
    if (liveData.length > 0) setSelectedFinding(liveData[0]);
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
        setTimeout(() => {
          setDismissed((prev) => new Set(prev).add(id));
          if (selectedFinding?.id === id) setSelectedFinding(null);
        }, 600);
      }
    } catch (err) {
      console.error(err);
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
    <div
      className="frame"
      style={{
        background: "#050505",
        minHeight: "100vh",
        paddingBottom: "100px",
      }}
    >
      <nav className="nav-bar nav-scrolled">
        <span className="logo">
          Tuff{" "}
          <span style={{ fontSize: "10px", color: "rgba(237,224,206,0.4)" }}>
            // console
          </span>
        </span>
        <div className="nav-right">
          <button
            onClick={logout}
            className="pill"
            style={{
              background: "transparent",
              border: "1px solid rgba(220,90,70,0.4)",
              color: "rgba(220,90,70,0.8)",
              cursor: "pointer",
            }}
          >
            Terminate Session
          </button>
        </div>
      </nav>

      <MetricsPanel
        totalSavings={totalSavings}
        zombiesCount={zombiesCount}
        hasFindings={findings.length > 0}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: "40px",
          padding: "0 4%",
          alignItems: "start",
        }}
      >
        <div style={{ position: "sticky", top: "140px" }}>
          <AwsConnectForm onScanComplete={handleScanSuccess} />
        </div>

        <div>
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: selectedFinding ? "1fr 340px" : "1fr",
              gap: "24px",
            }}
          >
            <section
              className="queue-section"
              style={{
                padding: "0",
                background: "transparent",
                border: "none",
              }}
            >
              <div className="queue-cols">
                <span className="col-label">Resource ID</span>
                <span className="col-label">Classification</span>
                <span className="col-label">Region</span>
                <span className="col-label">Waste</span>
                <span className="col-label">Savings</span>
                <span className="col-label">Load</span>
                <span className="col-label">Resolution</span>
              </div>
              <div id="findings">
                {findings.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "80px",
                      color: "rgba(237,224,206,0.2)",
                      fontSize: "11px",
                      textTransform: "uppercase",
                      border: "1px dashed #222",
                    }}
                  >
                    Awaiting secure cloud execution authorization mapping
                    coordinates.
                  </div>
                ) : filteredFindings.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "80px",
                      color: "rgba(237,224,206,0.4)",
                      fontSize: "11px",
                      textTransform: "uppercase",
                    }}
                  >
                    No alerts matched filter profile.
                  </div>
                ) : (
                  filteredFindings.map((f) => (
                    <div
                      key={f.id}
                      className={`finding ${selectedFinding?.id === f.id ? "active-row-border" : ""}`}
                      onClick={() => setSelectedFinding(f)}
                      style={{ cursor: "pointer" }}
                    >
                      <div>
                        <div
                          className="finding-id"
                          style={{
                            fontSize: "13px",
                            color: "#fff",
                            fontFamily: "monospace",
                          }}
                        >
                          {f.id}
                        </div>
                        <div className="finding-inst" style={{ opacity: 0.5 }}>
                          {f.inst}
                        </div>
                      </div>
                      <div>
                        <span className="badge">{f.type}</span>
                      </div>
                      <div className="finding-region">{f.region}</div>
                      <div className="finding-cost">{f.cur}</div>
                      <div
                        className="finding-save"
                        style={{ color: "#8cb982", fontWeight: "bold" }}
                      >
                        {f.save}
                      </div>
                      <div className="finding-cpu">{f.cpu}</div>
                      <div
                        style={{ display: "flex", gap: "6px" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {approved.has(f.id) ? (
                          <span
                            style={{
                              fontSize: "10px",
                              color: "#8cb982",
                              letterSpacing: ".1em",
                            }}
                          >
                            ⚙ EXECUTING...
                          </span>
                        ) : (
                          <>
                            <button
                              className="approve-btn"
                              onClick={() => handleApprove(f.id)}
                            >
                              Approve
                            </button>
                            <button
                              className="dismiss-btn"
                              onClick={() =>
                                setDismissed((prev) => new Set(prev).add(f.id))
                              }
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
            </section>

            <CodeDrawer
              selectedFinding={selectedFinding}
              onClose={() => setSelectedFinding(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
