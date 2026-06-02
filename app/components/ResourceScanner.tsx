import styles from "@/app/src/main_page/page.module.css";

interface ResourceScannerProps {
  scanningResource: string | null;
  onScanResourceType: (resourceType: string) => void;
}

export default function ResourceScanner({
  scanningResource,
  onScanResourceType,
}: ResourceScannerProps) {
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
      <h3 className={styles.scannerTitle}>
        Select Resource Type to Analyze
      </h3>
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
                  : resource.id.charAt(0).toUpperCase() + resource.id.slice(1)
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
