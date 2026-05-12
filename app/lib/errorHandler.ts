export function getAuthErrorMessage(error: any): string {
  const errorCode = error?.code || '';
  const errorMessage = error?.message || '';

  const errorMap: { [key: string]: string } = {
    'auth/user-not-found': 'Email or password is incorrect. Please try again.',
    'auth/wrong-password': 'Email or password is incorrect. Please try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/too-many-requests': 'Too many login attempts. Please try again later.',
    'auth/invalid-credential': 'Email or password is incorrect. Please try again.',

    'auth/email-already-in-use': 'This email is already registered. Please sign in or use a different email.',
    'auth/weak-password': 'Password should be at least 6 characters long.',
    'auth/operation-not-allowed': 'Account creation is not available. Please try again later.',

    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/popup-blocked': 'Popup blocked. Please allow popups and try again.',
    'auth/popup-closed-by-user': 'Sign-in cancelled. Please try again.',
    'auth/cancelled-popup-request': 'Sign-in cancelled. Please try again.',

    'auth/network-request-failed': 'Network connection error. Please check your internet and try again.',
  };

  if (errorMap[errorCode]) {
    return errorMap[errorCode];
  }

  if (errorMessage.includes('network') || errorMessage.includes('Network')) {
    return 'Network connection error. Please check your internet and try again.';
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
    return 'Request took too long. Please try again.';
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('firebase') || msg.includes('auth/')) {
      return 'An error occurred during authentication. Please try again.';
    }
  }

  return 'An unexpected error occurred. Please try again.';
}

export function getAPIErrorMessage(error: any, context: 'barcode' | 'product' | 'general' = 'general'): string {
  const status = error?.status || error?.statusCode;
  const message = error?.message || '';

  const statusMap: { [key: number]: string } = {
    400: 'Invalid request. Please check your input and try again.',
    401: 'Authentication failed. Please sign in again.',
    403: 'You do not have permission to perform this action.',
    404: 'Resource not found. Please try again.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Server error. Please try again later.',
    503: 'Service temporarily unavailable. Please try again later.',
  };

  if (statusMap[status]) {
    return statusMap[status];
  }

  const contextMessages = {
    barcode: 'Could not read the barcode. Please try a different photo or enter the barcode manually.',
    product: 'Could not find product information. Please try another product or enter details manually.',
    general: 'An error occurred. Please try again.',
  };

  if (message.includes('network') || message.includes('Network') || message.includes('fetch')) {
    return 'Network connection error. Please check your internet and try again.';
  }

  return contextMessages[context];
}

export function getGeneralErrorMessage(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  if (error instanceof TypeError) {
    return 'An error occurred while processing. Please try again.';
  }

  if (error instanceof RangeError) {
    return 'An error occurred. Please try again.';
  }

  if (error.code?.includes('auth/')) {
    return getAuthErrorMessage(error);
  }

  const message = error?.message || '';
  if (message.includes('network') || message.includes('Network')) {
    return 'Network connection error. Please check your internet and try again.';
  }

  if (message.includes('timeout')) {
    return 'Request took too long. Please try again.';
  }

  if (message.includes('API') || message.includes('api')) {
    return 'An error occurred. Please try again later.';
  }

  return 'An unexpected error occurred. Please try again.';
}

export function logErrorForDebug(error: any, context: string = '') {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}]`, error);
  }
}