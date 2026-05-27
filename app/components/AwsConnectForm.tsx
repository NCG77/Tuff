import { useState } from "react";

interface AwsConnectFormProps {
  onScanComplete: (liveData: any[]) => void;
}

export default function AwsConnectForm({
  onScanComplete,
}: AwsConnectFormProps) {
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    setError("");

    try {
      const response = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          aws_access_key: accessKey,
          aws_secret_key: secretKey,
          region: region,
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === "success") {
        onScanComplete(result.data);
      } else {
        setError(result.detail || "Failed to analyze cloud environment.");
      }
    } catch (err) {
      setError("Connection to backend API failed.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div
      className="aws-connect-card"
      style={{
        padding: "24px",
        background: "rgba(237, 224, 206, 0.03)",
        border: "1px solid rgba(237, 224, 206, 0.08)",
        borderRadius: "4px",
        marginBottom: "40px",
      }}
    >
      <h3
        style={{
          textTransform: "uppercase",
          letterSpacing: ".12em",
          fontSize: "14px",
          marginBottom: "16px",
        }}
      >
        Connect Target Cloud Environment
      </h3>

      {error && (
        <p style={{ color: "rgba(220,90,70,.8)", fontSize: "12px" }}>{error}</p>
      )}

      <form
        onSubmit={handleScan}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <input
          type="text"
          placeholder="AWS Access Key ID"
          value={accessKey}
          onChange={(e) => setAccessKey(e.target.value)}
          required
          style={{
            background: "#111",
            border: "1px solid #333",
            padding: "10px",
            color: "#fff",
          }}
        />
        <input
          type="password"
          placeholder="AWS Secret Access Key"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          required
          style={{
            background: "#111",
            border: "1px solid #333",
            padding: "10px",
            color: "#fff",
          }}
        />
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{
            background: "#111",
            border: "1px solid #333",
            padding: "10px",
            color: "#fff",
          }}
        >
          <option value="us-east-1">US East (N. Virginia)</option>
          <option value="us-west-2">US West (Oregon)</option>
          <option value="eu-west-1">Europe (Ireland)</option>
          <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
        </select>

        <button
          type="submit"
          disabled={scanning}
          style={{
            background: scanning ? "#333" : "#ede0ce",
            color: scanning ? "#777" : "#000",
            padding: "12px",
            border: "none",
            cursor: scanning ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            fontWeight: "bold",
            letterSpacing: ".1em",
          }}
        >
          {scanning
            ? "AGENT SCANNING INFRASTRUCTURE..."
            : "EXECUTE COGNITIVE AUDIT →"}
        </button>
      </form>
    </div>
  );
}
