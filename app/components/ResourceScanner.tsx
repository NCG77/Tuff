import { useState, useEffect } from "react";
import styles from "@/app/src/main_page/page.module.css";

interface ResourceScannerProps {
  scanningResource: string | null;
  onScanResourceType: (resourceType: string, regionOverride?: string) => void;
}

export default function ResourceScanner({
  scanningResource,
  onScanResourceType,
}: ResourceScannerProps) {
  const [selectedRegion, setSelectedRegion] = useState("all");

  useEffect(() => {
    const saved = localStorage.getItem("aws_credentials");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.region) {
          setSelectedRegion(parsed.region);
        }
      } catch (e) {}
    }
  }, []);

  const resourceTypes = [
    { id: "ec2", title: "EC2 Instances", desc: "Find idle or underutilized instances" },
    { id: "volume", title: "EBS Volumes", desc: "Detect unattached or unused volumes" },
    { id: "s3", title: "S3 Buckets", desc: "Identify misconfigured or public buckets" },
    { id: "vpc", title: "VPCs", desc: "Find unused VPCs and resources" },
    { id: "rds", title: "RDS Databases", desc: "Detect idle database instances" },
    { id: "all", title: "All Resources", desc: "Comprehensive infrastructure scan" },
  ];

  return (
    <div className={styles.resourceCardsPanel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h3 className={styles.scannerTitle} style={{ marginBottom: 0 }}>
          Select Resource Type to Analyze
        </h3>
        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          disabled={scanningResource !== null}
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #8b7355",
            padding: "8px 12px",
            color: "#000000",
            borderRadius: "4px",
            fontSize: "13px",
            fontWeight: 600,
            outline: "none",
            fontFamily: "Jost, sans-serif"
          }}
        >
          <option value="all">All Regions</option>
          <option value="us-east-1">US East (N. Virginia)</option>
          <option value="us-west-2">US West (Oregon)</option>
          <option value="eu-west-1">Europe (Ireland)</option>
          <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
          <option value="ap-south-1">Asia Pacific (Mumbai)</option>
        </select>
      </div>
      <div className={styles.resourceCardsGrid}>
        {resourceTypes.map((resource) => (
          <button
            key={resource.id}
            className={`${styles.resourceCard} ${
              scanningResource === resource.id ? styles.scanning : ""
            }`}
            onClick={() =>
              onScanResourceType(
                resource.id === "all"
                  ? "all"
                  : resource.id.charAt(0).toUpperCase() + resource.id.slice(1),
                selectedRegion
              )
            }
            disabled={scanningResource !== null}
          >
            <div className={styles.cardTitle}>{resource.title}</div>
            <div className={styles.cardDesc}>{resource.desc}</div>
            {scanningResource === resource.id && (
              <div className={styles.cardLoading}>⟳ Scanning...</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
