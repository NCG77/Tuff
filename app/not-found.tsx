import Link from "next/link";

export default function NotFound() {
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
      <h1 style={{ fontSize: "48px", fontWeight: 600, margin: 0 }}>404</h1>
      <p style={{ maxWidth: "420px", margin: 0, lineHeight: 1.6, color: "#8b7355" }}>
        We couldn&apos;t find that page.
      </p>
      <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
        <Link
          href="/"
          style={{
            padding: "10px 20px",
            background: "#8b7355",
            color: "#fff",
            borderRadius: "6px",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Go home
        </Link>
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
          Dashboard
        </Link>
      </div>
    </div>
  );
}
