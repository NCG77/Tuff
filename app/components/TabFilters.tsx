"use client";

interface TabFiltersProps {
  activeTab: "all" | "cost" | "security" | "logs" | "alerts";
  setActiveTab: (tab: "all" | "cost" | "security" | "logs" | "alerts") => void;
  allCount: number;
  costCount: number;
  securityCount: number;
}

export default function TabFilters({
  activeTab,
  setActiveTab,
  allCount,
  costCount,
  securityCount,
}: TabFiltersProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        marginBottom: "24px",
        borderBottom: "1px solid rgba(139, 115, 85, 0.2)",
        paddingBottom: "12px",
      }}
    >
      <button
        onClick={() => setActiveTab("all")}
        style={{
          background:
            activeTab === "all" ? "rgba(139, 115, 85, 0.15)" : "transparent",
          border: "none",
          color: activeTab === "all" ? "#4a3b2c" : "rgba(139, 115, 85, 0.7)",
          padding: "6px 12px",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        All Targets ({allCount})
      </button>
      <button
        onClick={() => setActiveTab("cost")}
        style={{
          background:
            activeTab === "cost" ? "rgba(139, 115, 85, 0.15)" : "transparent",
          border: "none",
          color: activeTab === "cost" ? "#2d5a22" : "rgba(139, 115, 85, 0.7)",
          padding: "6px 12px",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        FinOps Leaks ({costCount})
      </button>
      <button
        onClick={() => setActiveTab("security")}
        style={{
          background:
            activeTab === "security" ? "rgba(139, 115, 85, 0.15)" : "transparent",
          border: "none",
          color:
            activeTab === "security"
              ? "#a12c23"
              : "rgba(139, 115, 85, 0.7)",
          padding: "6px 12px",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        Security Vectors ({securityCount})
      </button>
    </div>
  );
}
