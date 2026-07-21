import { useState, useEffect } from "react";
import { api } from "@/app/lib/config";
import { useAuth } from "@/app/context/AuthContext";

interface AwsConnectFormProps {
  onScanComplete: (
    findings: any[],
    credentials: { keyId: string; secretKey: string },
  ) => void;
  onTokenLimit?: () => void;
}

export default function AwsConnectForm({
  onScanComplete,
  ...props
}: AwsConnectFormProps) {
  const { user } = useAuth();
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [generatingPolicy, setGeneratingPolicy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("aws_credentials");
    if (saved) {
      try {
        const {
          accessKey: key,
          secretKey: secret,
          region: reg,
        } = JSON.parse(saved);
        setAccessKey(key);
        setSecretKey(secret);
        setRegion(reg);
        onScanComplete([], { keyId: key, secretKey: secret });
      } catch (err) {}
    }
  }, []);

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessKey || !secretKey) {
      setError("Access Key and Secret Key are required");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user) {
        const token = await user.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aws_access_key: accessKey,
          aws_secret_key: secretKey,
          region: region,
        }),
      });

      if (response.ok) {
        localStorage.setItem(
          "aws_credentials",
          JSON.stringify({ accessKey, secretKey, region }),
        );
        setSuccess("AWS credentials saved successfully!");
        onScanComplete([], { keyId: accessKey, secretKey: secretKey });
        setTimeout(() => setSuccess(""), 3000);
      } else {
        const result = await response.json();
        setError(result.detail || "Failed to verify AWS credentials.");
      }
    } catch (err) {
      setError(
        "Connection to backend API failed. Unable to verify credentials.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    setError("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user) {
        const token = await user.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aws_access_key: accessKey,
          aws_secret_key: secretKey,
          region: region,
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === "success") {
        onScanComplete(result.data, { keyId: accessKey, secretKey: secretKey });
      } else {
        if (response.status === 429 && props.onTokenLimit) {
          props.onTokenLimit();
        } else {
          setError(result.detail || "Failed to analyze cloud environment.");
        }
      }
    } catch (err) {
      setError("Connection to backend API failed.");
    } finally {
      setScanning(false);
    }
  };

  const handleGenerateIAMPolicy = async () => {
    setGeneratingPolicy(true);
    setError("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user) {
        const token = await user.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(api.endpoints.generateIAMPolicy, {
        method: "POST",
        headers,
      });

      if (response.ok) {
        const result = await response.json();
        const policy = result.policy;
        const dataStr = JSON.stringify(policy, null, 2);
        const dataBlob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `tuff-iam-policy-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setSuccess("IAM policy downloaded successfully! Use this policy to create an IAM user with minimum required permissions.");
        setTimeout(() => setSuccess(""), 5000);
      } else {
        const errData = await response.json();
        setError(errData.detail || "Failed to generate IAM policy");
      }
    } catch (err) {
      setError("Connection to backend API failed. Please ensure the backend is running.");
    } finally {
      setGeneratingPolicy(false);
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
          color: "#3d3d3d",
          fontWeight: 600,
        }}
      >
        Connect Target Cloud Environment
      </h3>

      {error && (
        <p
          style={{
            color: "#d43a2a",
            fontSize: "12px",
            marginBottom: "12px",
            fontWeight: 500,
          }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          style={{
            color: "#648c50",
            fontSize: "12px",
            marginBottom: "12px",
            fontWeight: 500,
          }}
        >
          ✓ {success}
        </p>
      )}

      <form
        onSubmit={handleSaveCredentials}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <input
          type="text"
          placeholder="AWS Access Key ID"
          value={accessKey}
          onChange={(e) => setAccessKey(e.target.value)}
          required
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #8b7355",
            padding: "10px",
            color: "#000000",
            borderRadius: "4px",
          }}
        />
        <input
          type="password"
          placeholder="AWS Secret Access Key"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          required
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #8b7355",
            padding: "10px",
            color: "#000000",
            borderRadius: "4px",
          }}
        />
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #8b7355",
            padding: "10px",
            color: "#000000",
            borderRadius: "4px",
          }}
        >
          <option value="all">All Regions</option>
          <option value="us-east-1">US East (N. Virginia)</option>
          <option value="us-west-2">US West (Oregon)</option>
          <option value="eu-west-1">Europe (Ireland)</option>
          <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
          <option value="ap-south-1">Asia Pacific (Mumbai)</option>
        </select>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              flex: 1,
              background: saving ? "#d3d3d3" : "#8b7355",
              color: "#ffffff",
              padding: "12px",
              border: "none",
              borderRadius: "4px",
              cursor: saving ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              fontWeight: "bold",
              letterSpacing: ".1em",
              fontSize: "12px",
              transition: "background 0.3s",
            }}
          >
            {saving ? "VERIFYING..." : "SAVE CREDENTIALS"}
          </button>

          <button
            type="button"
            onClick={handleScan}
            disabled={scanning || !accessKey || !secretKey}
            style={{
              flex: 1,
              background:
                scanning || !accessKey || !secretKey ? "#d3d3d3" : "#648c50",
              color: "#ffffff",
              padding: "12px",
              border: "none",
              borderRadius: "4px",
              cursor:
                scanning || !accessKey || !secretKey
                  ? "not-allowed"
                  : "pointer",
              textTransform: "uppercase",
              fontWeight: "bold",
              letterSpacing: ".1em",
              fontSize: "12px",
              transition: "background 0.3s",
            }}
          >
            {scanning ? "SCANNING..." : "SCAN NOW →"}
          </button>
        </div>

        <button
          type="button"
          onClick={handleGenerateIAMPolicy}
          disabled={generatingPolicy}
          style={{
            width: "100%",
            background: generatingPolicy ? "#d3d3d3" : "#5a7a9e",
            color: "#ffffff",
            padding: "12px",
            border: "none",
            borderRadius: "4px",
            cursor: generatingPolicy ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            fontWeight: "bold",
            letterSpacing: ".1em",
            fontSize: "12px",
            transition: "background 0.3s",
            marginTop: "8px",
          }}
        >
          {generatingPolicy ? "⟳ GENERATING..." : "GENERATE IAM POLICY"}
        </button>
      </form>
    </div>
  );
}
