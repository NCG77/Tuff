"use client";

interface MetricsPanelProps {
  totalSavings: number;
  zombiesCount: number;
  hasFindings: boolean;
}

export default function MetricsPanel({
  totalSavings,
  zombiesCount,
  hasFindings,
}: MetricsPanelProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 340px",
        gap: "40px",
        padding: "0 4%",
        marginTop: "140px",
        marginBottom: "40px",
      }}
    >
      <div
        className="metrics"
        style={{
          padding: "0",
          margin: "0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <div className="metric">
          <div
            className="metric-num"
            style={{ color: totalSavings > 0 ? "#8cb982" : "#ede0ce" }}
          >
            ${totalSavings.toLocaleString()}/mo
          </div>
          <div className="metric-label">Recoverable Leakage Value</div>
        </div>
        <div className="metric">
          <div className="metric-num">{zombiesCount}</div>
          <div className="metric-label">Active Anomalous Vectors</div>
        </div>
      </div>

      {/* Cumulative Burn Optimization Chart Simulation Box */}
      <div
        style={{
          background: "rgba(237,224,206,0.02)",
          border: "1px solid rgba(237,224,206,0.06)",
          borderRadius: "4px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: "rgba(237,224,206,0.4)",
          }}
        >
          Cost Trajectory Delta Projection
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "8px",
            height: "50px",
            paddingBottom: "4px",
            borderBottom: "1px solid rgba(237,224,206,0.1)",
          }}
        >
          <div
            style={{
              background: "rgba(220,90,70,0.3)",
              width: "25%",
              height: hasFindings ? "90%" : "20%",
              transition: "all 0.6s",
            }}
          ></div>
          <div
            style={{
              background: "rgba(237,224,206,0.2)",
              width: "25%",
              height: hasFindings ? "70%" : "20%",
              transition: "all 0.6s",
            }}
          ></div>
          <div
            style={{
              background: "#8cb982",
              width: "25%",
              height: hasFindings ? "35%" : "20%",
              transition: "all 0.6s",
            }}
          ></div>
          <div
            style={{
              background: "#8cb982",
              width: "25%",
              height: hasFindings ? "12%" : "20%",
              transition: "all 0.6s",
            }}
          ></div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "9px",
            opacity: 0.4,
            fontFamily: "monospace",
          }}
        >
          <span>Wk 1</span>
          <span>Wk 2</span>
          <span>Wk 3</span>
          <span>Optimized</span>
        </div>
      </div>
    </div>
  );
}
