import { useEffect, useMemo, useRef, useState } from "react";
import { api, devLog, extractErrorMessage, networkErrorMessage } from "@/app/lib/config";
import { useAuth } from "@/app/context/AuthContext";
import {
  clearCredentials,
  getPreferredRegion,
  isEncryptionConfigured,
  loadCredentials,
  saveCredentials,
  setPreferredRegion,
  validateCredentialInput,
} from "@/app/lib/credentials";
import type { Finding } from "@/app/lib/types";

interface AwsConnectFormProps {
  onScanComplete: (
    findings: Finding[],
    credentials: { accessKey: string; secretKey: string; region: string },
  ) => void;
  onTokenLimit?: () => void;
  onCreditsChange?: (credits: number) => void;
}

const REGIONS = [
  { value: "all", label: "All Regions (slower)" },
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
];

// A full multi-region scan legitimately takes a while; only warn once it is
// clearly longer than normal.
const SLOW_SCAN_NOTICE_MS = 90_000;

export default function AwsConnectForm({
  onScanComplete,
  onTokenLimit,
  onCreditsChange,
}: AwsConnectFormProps) {
  const { user } = useAuth();

  // Decrypt the stored credentials once, during the first render, and seed the
  // form fields from them. This component only mounts after authentication has
  // resolved on the client, so touching browser storage here is safe and
  // avoids an extra render pass.
  const initial = useMemo(() => {
    const stored = user ? loadCredentials(user.uid) : null;
    return {
      accessKey: stored?.accessKey ?? "",
      secretKey: stored?.secretKey ?? "",
      region: stored?.region ?? getPreferredRegion(),
    };
  }, [user]);

  const [accessKey, setAccessKey] = useState(initial.accessKey);
  const [secretKey, setSecretKey] = useState(initial.secretKey);
  const [region, setRegion] = useState(initial.region);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [generatingPolicy, setGeneratingPolicy] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [hasStoredCredentials, setHasStoredCredentials] = useState(Boolean(initial.accessKey));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!scanning) return;
    const timer = setTimeout(() => setShowSlowNotice(true), SLOW_SCAN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [scanning]);

  // Abandon an in-flight scan if the form unmounts, so its result cannot be
  // applied to a dashboard the user has already navigated away from.
  useEffect(() => () => abortRef.current?.abort(), []);

  const runScan = async () => {
    if (!user) {
      setError("Please sign in again before connecting an AWS account.");
      return;
    }

    const validationError = validateCredentialInput(accessKey, secretKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    setShowSlowNotice(false);
    setScanning(true);
    setError("");
    setSuccess("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await user.getIdToken();
      // Encrypt once and reuse the same envelope for storage and for the
      // request, so the browser never holds or transmits the raw secret.
      const stored = saveCredentials(user.uid, {
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        region,
      });
      setHasStoredCredentials(true);
      setPreferredRegion(region);

      const response = await fetch(api.endpoints.analyze, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          aws_access_key: stored.accessKey,
          aws_secret_key: stored.secretKey,
          region,
        }),
      });

      if (!response.ok) {
        // 402/429 mean the account is out of AI credits rather than that the
        // credentials are wrong, so route the user to the upgrade flow.
        if ((response.status === 429 || response.status === 402) && onTokenLimit) {
          onTokenLimit();
          return;
        }
        setError(await extractErrorMessage(response, "Tuff could not analyse your AWS account."));
        return;
      }

      const result = await response.json();
      const findings: Finding[] = Array.isArray(result?.data) ? result.data : [];

      if (typeof result?.credits_remaining === "number") {
        onCreditsChange?.(result.credits_remaining);
      }

      const notes: string[] = [`Connected. ${findings.length} finding(s) returned.`];
      if (result?.failed_regions?.length) {
        notes.push(`Could not read: ${result.failed_regions.join(", ")}.`);
      }
      if (result?.deferred_count) {
        notes.push(`${result.deferred_count} finding(s) need Pro for AI analysis.`);
      }
      setSuccess(notes.join(" "));

      onScanComplete(findings, {
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        region,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      devLog("AWS scan failed", err);
      setError(networkErrorMessage());
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runScan();
  };

  const handleDisconnect = () => {
    clearCredentials();
    setAccessKey("");
    setSecretKey("");
    setHasStoredCredentials(false);
    setSuccess("AWS credentials removed from this browser.");
    setError("");
  };

  const handleGenerateIAMPolicy = async () => {
    if (!user) {
      setError("Please sign in again to download the IAM policy.");
      return;
    }

    setGeneratingPolicy(true);
    setError("");

    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;
    try {
      const token = await user.getIdToken();
      const response = await fetch(api.endpoints.generateIAMPolicy, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        setError(await extractErrorMessage(response, "Could not generate the IAM policy."));
        return;
      }

      const result = await response.json();
      const dataBlob = new Blob([JSON.stringify(result.policy, null, 2)], {
        type: "application/json",
      });
      url = URL.createObjectURL(dataBlob);
      link = document.createElement("a");
      link.href = url;
      link.download = `tuff-iam-policy-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(link);
      link.click();

      setSuccess("IAM policy downloaded. Attach it to a dedicated IAM user for Tuff.");
    } catch (err) {
      devLog("IAM policy download failed", err);
      setError(networkErrorMessage());
    } finally {
      // Cleanup runs even when the click handler throws, so we don't leak the
      // object URL or leave a stray anchor in the DOM.
      if (link?.parentNode) link.parentNode.removeChild(link);
      if (url) URL.revokeObjectURL(url);
      setGeneratingPolicy(false);
    }
  };

  const canScan = !scanning && accessKey.trim().length > 0 && secretKey.trim().length > 0;

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
      {scanning && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff9c4",
            border: "1px solid #fbc02d",
            padding: "16px 24px",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
            color: "#f57f17",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "24px" }}>{showSlowNotice ? "⚠️" : "⏳"}</div>
          <div>
            <p style={{ margin: 0, fontWeight: "bold", fontSize: "16px" }}>
              {showSlowNotice ? "Still working" : "Scanning your AWS account"}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "14px" }}>
              {showSlowNotice
                ? "Large accounts and all-region scans can take several minutes."
                : region === "all"
                  ? "Reading every region — this usually takes 1-3 minutes."
                  : "Reading CloudWatch metrics and resource configuration."}
            </p>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              style={{
                marginTop: "8px",
                padding: "4px 12px",
                background: "#fbc02d",
                border: "none",
                borderRadius: "4px",
                color: "#000",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Cancel scan
            </button>
          </div>
        </div>
      )}

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
          role="alert"
          style={{ color: "#d43a2a", fontSize: "12px", marginBottom: "12px", fontWeight: 500 }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          style={{ color: "#648c50", fontSize: "12px", marginBottom: "12px", fontWeight: 500 }}
        >
          ✓ {success}
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label htmlFor="aws-access-key" style={{ fontSize: "12px", color: "#3d3d3d", fontWeight: 600 }}>
          AWS Access Key ID
        </label>
        <input
          id="aws-access-key"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="AKIA..."
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

        <label htmlFor="aws-secret-key" style={{ fontSize: "12px", color: "#3d3d3d", fontWeight: 600 }}>
          AWS Secret Access Key
        </label>
        <input
          id="aws-secret-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="••••••••••••••••••••"
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

        <label htmlFor="aws-region" style={{ fontSize: "12px", color: "#3d3d3d", fontWeight: 600 }}>
          Region
        </label>
        <select
          id="aws-region"
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
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!canScan}
          style={{
            background: canScan ? "#648c50" : "#d3d3d3",
            color: "#ffffff",
            padding: "12px",
            border: "none",
            borderRadius: "4px",
            cursor: canScan ? "pointer" : "not-allowed",
            textTransform: "uppercase",
            fontWeight: "bold",
            letterSpacing: ".1em",
            fontSize: "12px",
            transition: "background 0.3s",
          }}
        >
          {scanning ? "SCANNING..." : "CONNECT & SCAN →"}
        </button>

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
          }}
        >
          {generatingPolicy ? "⟳ GENERATING..." : "DOWNLOAD IAM POLICY"}
        </button>

        {hasStoredCredentials && (
          <button
            type="button"
            onClick={handleDisconnect}
            style={{
              width: "100%",
              background: "transparent",
              color: "#d43a2a",
              padding: "10px",
              border: "1px solid rgba(212, 58, 42, 0.35)",
              borderRadius: "4px",
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 600,
              letterSpacing: ".1em",
              fontSize: "11px",
            }}
          >
            Disconnect & forget keys
          </button>
        )}
      </form>

      <p style={{ fontSize: "11px", color: "#8b7355", marginTop: "16px", lineHeight: 1.6 }}>
        Keys are held only for this browser tab and are cleared when you sign out or close it.
        {!isEncryptionConfigured && " Set NEXT_PUBLIC_ENCRYPTION_KEY to encrypt them at rest."} Use a
        dedicated IAM user with the downloadable policy above rather than your root credentials.
      </p>
    </div>
  );
}
