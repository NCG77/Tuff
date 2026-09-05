/**
 * Evaluates alert thresholds off the main thread.
 *
 * Metric values arrive as display strings ("$174/mo", "3.2%"), so they are
 * parsed with a regex rather than `parseFloat`, which returns NaN for anything
 * with a leading currency symbol -- and every comparison against NaN is false,
 * so cost and savings alerts never fired.
 */

interface AlertConfigMessage {
  id: string;
  resourceType: string;
  metric: string;
  threshold: number;
  thresholdType: string;
}

interface FindingMessage {
  uid: string;
  id: string;
  type: string;
  [key: string]: unknown;
}

function parseMetric(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const match = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

self.onmessage = (event: MessageEvent) => {
  const { alertConfigs, findings, dismissedList } = event.data as {
    alertConfigs: AlertConfigMessage[];
    findings: FindingMessage[];
    dismissedList: string[];
  };

  const dismissed = new Set(dismissedList ?? []);
  const triggered: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const timestamp = new Date().toISOString();

  (alertConfigs ?? []).forEach((config) => {
    if (!config?.metric || typeof config.threshold !== "number") return;

    (findings ?? []).forEach((finding) => {
      if (dismissed.has(finding.uid)) return;
      if (!finding.type?.includes(config.resourceType)) return;

      const value = parseMetric(finding[config.metric.toLowerCase()]);
      if (value === null) return;

      const isTriggered =
        config.thresholdType === "below" ? value < config.threshold : value > config.threshold;
      if (!isTriggered) return;

      const alertId = `${config.id}-${finding.uid}`;
      if (seen.has(alertId)) return;
      seen.add(alertId);

      triggered.push({
        id: alertId,
        configId: config.id,
        resourceId: finding.id,
        resourceType: finding.type,
        metric: config.metric,
        value,
        threshold: config.threshold,
        condition: config.thresholdType,
        timestamp,
      });
    });
  });

  self.postMessage(triggered);
};
