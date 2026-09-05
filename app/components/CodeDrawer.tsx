"use client";

import type { Finding } from "@/app/lib/types";

interface CodeDrawerProps {
  selectedFinding: Finding | null;
  onClose: () => void;
}

export default function CodeDrawer({
  selectedFinding,
  onClose,
}: CodeDrawerProps) {
  if (!selectedFinding) return null;

  const generateBashCommand = (item: Finding) => {
    if (item.type.includes("Volume"))
      return `aws ec2 delete-volume \\\n  --volume-id ${item.id} \\\n  --region ${item.region}`;
    if (item.type.includes("RDS"))
      return `aws rds stop-db-instance \\\n  --db-instance-identifier ${item.id} \\\n  --region ${item.region}`;
    if (item.type.includes("VPC"))
      return `aws ec2 delete-vpc \\\n  --vpc-id ${item.id} \\\n  --region ${item.region}`;
    // Checked after the more specific types, because "Scaling Candidate (EC2)"
    // also contains "EC2".
    if (item.type.includes("EC2"))
      return `aws ec2 stop-instances \\\n  --instance-ids ${item.id} \\\n  --region ${item.region}`;
    return `aws s3api put-public-access-block \\\n  --bucket ${item.id} \\\n  --public-access-block-configuration \\\n  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"`;
  };

  return (
    <div
      style={{
        background: "#0e0e0e",
        border: "1px solid rgba(237,224,206,0.08)",
        borderRadius: "4px",
        padding: "20px",
        position: "sticky",
        top: "140px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: "#ede0ce",
            fontWeight: "bold",
          }}
        >
          Agent Script Context
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(237,224,206,0.4)",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          fontSize: "12px",
          color: "#fff",
          fontFamily: "monospace",
          marginBottom: "6px",
          wordBreak: "break-all",
        }}
      >
        {selectedFinding.id}
      </div>
      <p
        style={{
          fontSize: "11px",
          color: "rgba(237,224,206,0.6)",
          lineHeight: "1.4",
          marginBottom: "16px",
        }}
      >
        {selectedFinding.explanation}
      </p>

      <div
        style={{
          fontSize: "9px",
          textTransform: "uppercase",
          color: "rgba(237,224,206,0.4)",
          marginBottom: "6px",
          fontFamily: "monospace",
        }}
      >
        Target Action Script CLI Payload
      </div>
      <pre
        style={{
          background: "#000",
          border: "1px solid #222",
          padding: "12px",
          borderRadius: "3px",
          color: "#a8ff60",
          fontSize: "10px",
          fontFamily: "monospace",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          lineHeight: "1.5",
        }}
      >
        {generateBashCommand(selectedFinding)}
      </pre>

      <div
        style={{
          marginTop: "20px",
          padding: "12px",
          background: "rgba(237,224,206,0.02)",
          borderRadius: "3px",
          borderLeft: "2px solid rgba(237,224,206,0.2)",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "#ede0ce",
            textTransform: "uppercase",
            marginBottom: "4px",
          }}
        >
          Business System Impact Summary
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "rgba(237,224,206,0.5)",
            lineHeight: "1.4",
          }}
        >
          {selectedFinding.business_impact}
        </div>
      </div>
    </div>
  );
}
