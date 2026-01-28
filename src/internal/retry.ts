import { BearWatchError, type ErrorCode } from '../errors.js';

/** Status codes that should trigger a retry */
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

/** Error codes that should trigger a retry */
const RETRYABLE_ERROR_CODES: ErrorCode[] = ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'];

/** BearWatchError with optional Retry-After header */
export type BearWatchErrorWithRetry = BearWatchError & { retryAfter?: string | null };

/**
 * Checks if an error is retryable.
 */
export function isRetryable(error: BearWatchError): boolean {
  if (error.statusCode && RETRYABLE_STATUS_CODES.includes(error.statusCode)) {
    return true;
  }
  return RETRYABLE_ERROR_CODES.includes(error.code);
}

/**
 * Calculates delay using exponential backoff with jitter.
 * Jitter helps prevent thundering herd problem when many clients retry simultaneously.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @returns Delay in milliseconds with jitter applied
 */
export function calculateBackoffDelay(attempt: number, baseDelay: number): number {
  // Exponential backoff: 500ms → 1000ms → 2000ms (without jitter)
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Apply jitter: multiply by random factor between 0.5 and 1.0
  // Same as Java SDK: 0.5 + Math.random() * 0.5
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.floor(exponentialDelay * jitter);
}

/**
 * Parses Retry-After header value.
 * @param retryAfter - Header value (seconds or HTTP-date)
 * @returns Delay in milliseconds, or null if invalid
 */
export function parseRetryAfter(retryAfter: string | null): number | null {
  if (!retryAfter) {
    return null;
  }

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return Math.max(0, delay);
  }

  return null;
}

/**
 * Sleeps for specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelay: number;
}

/**
 * Executes a function with retry logic.
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: BearWatchError | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof BearWatchError)) {
        throw error;
      }

      lastError = error;

      // Check if we should retry
      if (!isRetryable(error) || attempt >= options.maxRetries) {
        throw error;
      }

      // Calculate delay
      let delay: number;
      if (error.code === 'RATE_LIMITED') {
        // For 429, prefer Retry-After header from error
        const errorWithRetry = error as BearWatchErrorWithRetry;
        const retryAfterDelay = parseRetryAfter(errorWithRetry.retryAfter ?? null);
        delay = retryAfterDelay ?? calculateBackoffDelay(attempt, options.baseDelay);
      } else {
        delay = calculateBackoffDelay(attempt, options.baseDelay);
      }

      await sleep(delay);
    }
  }

  // This should not be reached, but TypeScript needs it
  throw lastError;
}
