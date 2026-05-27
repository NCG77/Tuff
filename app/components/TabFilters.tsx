"use client";

interface TabFiltersProps {
  activeTab: "all" | "cost" | "security";
  setActiveTab: (tab: "all" | "cost" | "security") => void;
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
        borderBottom: "1px solid rgba(237,224,206,0.08)",
        paddingBottom: "12px",
      }}
    >
      <button
        onClick={() => setActiveTab("all")}
        style={{
          background:
            activeTab === "all" ? "rgba(237,224,206,0.08)" : "transparent",
          border: "none",
          color: "#fff",
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
            activeTab === "cost" ? "rgba(237,224,206,0.08)" : "transparent",
          border: "none",
          color: activeTab === "cost" ? "#8cb982" : "rgba(237,224,206,0.6)",
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
            activeTab === "security" ? "rgba(237,224,206,0.08)" : "transparent",
          border: "none",
          color:
            activeTab === "security"
              ? "rgba(220,90,70,1)"
              : "rgba(237,224,206,0.6)",
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
