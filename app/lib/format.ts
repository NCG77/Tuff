/** Display helpers shared by the dashboard panels. */

/**
 * Pull a number out of a display string such as `"$174/mo"` or `"3.2%"`.
 *
 * Values arriving from the API are pre-formatted strings, so a bare
 * `parseFloat` returns NaN for anything with a leading currency symbol.
 */
export function parseMetric(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const match = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

/**
 * Format USD without collapsing small amounts to zero.
 *
 * Dividing by 1000 unconditionally rendered $450 as "$0.5K" and $40 as
 * "$0.0K", which read as "no savings available".
 */
export function formatCurrency(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  if (abs >= 100) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Render a UTC timestamp from the API in the viewer's local timezone.
 *
 * The API sends explicit UTC (`...Z`); older records may be missing the zone,
 * so it is assumed rather than being silently read as local time.
 */
export function formatTimestamp(value: string | number | Date | null | undefined): string {
  if (!value) return "—";

  let input = value;
  if (typeof input === "string" && !/(Z|[+-]\d{2}:?\d{2})$/.test(input) && input.includes("T")) {
    input = `${input}Z`;
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "—";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short relative label, e.g. "4 minutes ago". */
export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const normalised = !/(Z|[+-]\d{2}:?\d{2})$/.test(value) && value.includes("T") ? `${value}Z` : value;
  const then = new Date(normalised).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["month", 2_592_000],
    ["year", 31_536_000],
  ];

  let chosen: Intl.RelativeTimeFormatUnit = "minute";
  let divisor = 60;
  for (const [unit, unitSeconds] of units) {
    if (seconds >= unitSeconds) {
      chosen = unit;
      divisor = unitSeconds;
    }
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(-Math.round(seconds / divisor), chosen);
}

/** Total the savings across findings, tolerating missing or prose values. */
export function sumSavings(findings: Array<{ save?: unknown }>): number {
  const total = findings.reduce((acc, finding) => acc + parseMetric(finding.save), 0);
  return Number(total.toFixed(2));
}
