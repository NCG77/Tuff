/** Maps thrown values onto copy that is safe and useful to show a user. */

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  statusCode?: number;
}

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  if (typeof error === 'string') return { message: error };
  return {};
}

export function getAuthErrorMessage(error: unknown): string {
  const { code = '', message = '' } = asErrorLike(error);

  const errorMap: { [key: string]: string } = {
    'auth/user-not-found': 'Email or password is incorrect. Please try again.',
    'auth/wrong-password': 'Email or password is incorrect. Please try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/too-many-requests': 'Too many login attempts. Please try again later.',
    'auth/invalid-credential': 'Email or password is incorrect. Please try again.',
    'auth/missing-password': 'Please enter your password.',

    'auth/email-already-in-use': 'This email is already registered. Please sign in or use a different email.',
    'auth/weak-password': 'Please choose a longer, harder-to-guess password.',
    'auth/operation-not-allowed': 'Account creation is not available. Please try again later.',

    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/popup-blocked': 'Popup blocked. Please allow popups and try again.',
    'auth/popup-closed-by-user': 'Sign-in cancelled. Please try again.',
    'auth/cancelled-popup-request': 'Sign-in cancelled. Please try again.',
    'auth/unauthorized-domain': 'This domain is not authorised for sign-in. Add it in your Firebase console.',

    'auth/network-request-failed': 'Network connection error. Please check your internet and try again.',
    'auth/invalid-api-key': 'Sign-in is misconfigured. Please contact support.',
  };

  if (errorMap[code]) {
    return errorMap[code];
  }

  if (/network/i.test(message)) {
    return 'Network connection error. Please check your internet and try again.';
  }

  if (/timeout/i.test(message)) {
    return 'Request took too long. Please try again.';
  }

  if (code.startsWith('auth/') || /firebase/i.test(message)) {
    return 'An error occurred during authentication. Please try again.';
  }

  return 'An unexpected error occurred. Please try again.';
}

export function getAPIErrorMessage(error: unknown): string {
  const { status, statusCode, message = '' } = asErrorLike(error);
  const code = status ?? statusCode;

  const statusMap: { [key: number]: string } = {
    400: 'Invalid request. Please check your input and try again.',
    401: 'Your session has expired. Please sign in again.',
    402: 'You have used all your AI credits. Upgrade to continue.',
    403: 'You do not have permission to perform this action.',
    404: 'We could not find what you were looking for.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Server error. Please try again later.',
    502: 'The upstream service failed. Please try again.',
    503: 'Service temporarily unavailable. Please try again later.',
  };

  if (code !== undefined && statusMap[code]) {
    return statusMap[code];
  }

  if (/network|fetch/i.test(message)) {
    return 'Network connection error. Please check your internet and try again.';
  }

  return 'An error occurred. Please try again.';
}

export function getGeneralErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const { code = '', message = '' } = asErrorLike(error);

  if (code.includes('auth/')) {
    return getAuthErrorMessage(error);
  }

  if (/network/i.test(message)) {
    return 'Network connection error. Please check your internet and try again.';
  }

  if (/timeout/i.test(message)) {
    return 'Request took too long. Please try again.';
  }

  return 'An unexpected error occurred. Please try again.';
}

export function logErrorForDebug(error: unknown, context: string = '') {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}]`, error);
  }
}
