/**
 * Short-lived sessionStorage cache for dashboard API slices.
 * Avoids cold-hitting Supabase on every refresh within the TTL window.
 */

const PREFIX = "tuff:dash:";
export const DASHBOARD_CACHE_TTL_MS = 45_000;

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
};

function keyFor(uid: string, slice: string): string {
  return `${PREFIX}${uid}:${slice}`;
}

export function readDashboardCache<T>(uid: string, slice: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(keyFor(uid, slice));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > DASHBOARD_CACHE_TTL_MS) {
      sessionStorage.removeItem(keyFor(uid, slice));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeDashboardCache<T>(uid: string, slice: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: CacheEnvelope<T> = { savedAt: Date.now(), data };
    sessionStorage.setItem(keyFor(uid, slice), JSON.stringify(envelope));
  } catch {
    // Quota / private mode — ignore; network path still works.
  }
}

export function clearDashboardCache(uid?: string): void {
  if (typeof window === "undefined") return;
  try {
    const needle = uid ? `${PREFIX}${uid}:` : PREFIX;
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(needle)) toRemove.push(key);
    }
    toRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // ignore
  }
}
