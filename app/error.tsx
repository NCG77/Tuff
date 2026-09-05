"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logErrorForDebug } from "./lib/errorHandler";

/**
 * Route-level error boundary.
 *
 * Without this an unhandled render error dropped the user on Next.js's default
 * error screen with no way back into the app.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logErrorForDebug(error, "app/error");
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "32px",
        textAlign: "center",
        fontFamily: "Jost, sans-serif",
        background: "#f9f7f4",
        color: "#6b5344",
      }}
    >
      <h1 style={{ fontSize: "28px", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
      <p style={{ maxWidth: "460px", margin: 0, lineHeight: 1.6, color: "#8b7355" }}>
        Tuff hit an unexpected error while rendering this page. Your cloud resources were not
        modified.
      </p>
      {error.digest && (
        <code style={{ fontSize: "12px", color: "rgba(139, 115, 85, 0.7)" }}>
          Reference: {error.digest}
        </code>
      )}
      <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
        <button
          onClick={reset}
          style={{
            padding: "10px 20px",
            background: "#8b7355",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
        <Link
          href="/src/main_page"
          style={{
            padding: "10px 20px",
            background: "rgba(139, 115, 85, 0.08)",
            color: "#8b7355",
            border: "1px solid rgba(139, 115, 85, 0.25)",
            borderRadius: "6px",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
