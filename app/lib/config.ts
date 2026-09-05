// Configuration utility for API endpoints
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = {
  baseURL: API_URL,
  endpoints: {
    userSync: `${API_URL}/api/user/sync`,
    analyze: `${API_URL}/api/analyze`,
    execute: `${API_URL}/api/execute`,
    alertsConfig: `${API_URL}/api/alerts/config`,
    alertsEvaluate: `${API_URL}/api/alerts/evaluate`,
    alertsTriggered: `${API_URL}/api/alerts/triggered`,
    actionLogs: `${API_URL}/api/action-logs`,
    executionLogs: `${API_URL}/api/logs/execution`,
    infrastructureLogs: `${API_URL}/api/logs/infrastructure`,
    generateIAMPolicy: `${API_URL}/api/generate-iam-policy`,
    humanize: `${API_URL}/api/humanize`,
    buyCredits: `${API_URL}/api/user/credits/buy`,
    verifyPayment: `${API_URL}/api/user/verify-payment`,
  },
};

export const isDevelopment = process.env.NODE_ENV === 'development';

// Utility function to log only in development
export const devLog = (message: string, data?: unknown) => {
  if (isDevelopment) {
    console.log(message, data || '');
  }
};

export const devError = (message: string, error?: unknown) => {
  if (isDevelopment) {
    console.error(message, error || '');
  }
};

/**
 * Read the error message out of a failed response.
 *
 * Calling `response.json()` unconditionally throws when the body is not JSON,
 * which happens for gateway timeouts and proxy errors -- the parse error then
 * replaced the real failure with a confusing one.
 */
export async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;

    try {
      const data = JSON.parse(text);
      const detail = data?.detail ?? data?.message;

      if (typeof detail === 'string') return detail;
      // FastAPI validation errors arrive as a list of field descriptors.
      if (Array.isArray(detail)) {
        const parts = detail
          .map((item) => {
            const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : undefined;
            return field ? `${field}: ${item?.msg}` : item?.msg;
          })
          .filter(Boolean);
        if (parts.length) return parts.join('; ');
      }
      return fallback;
    } catch {
      return response.status >= 500 ? fallback : text.slice(0, 300);
    }
  } catch {
    return fallback;
  }
}

/** Friendly copy for transport-level failures, where there is no response. */
export function networkErrorMessage(): string {
  return 'Could not reach the Tuff API. Check your connection and that the backend is running.';
}
