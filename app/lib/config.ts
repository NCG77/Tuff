// Configuration utility for API endpoints
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

if (!API_URL) {
  console.error('NEXT_PUBLIC_API_URL is not configured');
}

export const api = {
  baseURL: API_URL,
  endpoints: {
    analyze: `${API_URL}/api/analyze`,
    execute: `${API_URL}/api/execute`,
    alertsConfig: `${API_URL}/api/alerts/config`,
    alertsEvaluate: `${API_URL}/api/alerts/evaluate`,
    alertsTriggered: `${API_URL}/api/alerts/triggered`,
    actionLogs: `${API_URL}/api/action-logs`,
    generateIAMPolicy: `${API_URL}/api/generate-iam-policy`,
  },
};

export const isDevelopment = process.env.NODE_ENV === 'development';

// Utility function to log only in development
export const devLog = (message: string, data?: any) => {
  if (isDevelopment) {
    console.log(message, data || '');
  }
};

export const devError = (message: string, error?: any) => {
  if (isDevelopment) {
    console.error(message, error || '');
  }
};
