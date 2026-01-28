/**
 * Error codes for BearWatch operations.
 */
export type ErrorCode =
  | 'INVALID_API_KEY'
  | 'JOB_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

/**
 * Context information for debugging.
 */
export interface ErrorContext {
  /** Job ID involved in the operation */
  jobId?: string;
  /** Run ID involved in the operation */
  runId?: string;
  /** Operation that caused the error */
  operation?: 'ping' | 'start' | 'complete' | 'fail';
}

/**
 * Options for creating a BearWatchError.
 */
export interface BearWatchErrorOptions {
  /** Error code */
  code: ErrorCode;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Raw response body for debugging (may contain PII) */
  responseBody?: string;
  /** Context information */
  context?: ErrorContext;
  /** Original error that caused this error */
  cause?: Error;
}

/**
 * Custom error class for BearWatch SDK.
 *
 * @example
 * ```typescript
 * try {
 *   await bw.ping('my-job');
 * } catch (error) {
 *   if (error instanceof BearWatchError) {
 *     console.error(`Error code: ${error.code}`);
 *     console.error(`Status: ${error.statusCode}`);
 *     console.error(`Context: ${JSON.stringify(error.context)}`);
 *   }
 * }
 * ```
 */
export class BearWatchError extends Error {
  readonly code: ErrorCode;
  readonly statusCode?: number;
  /** Raw response body for debugging. WARNING: May contain PII. */
  readonly responseBody?: string;
  readonly context?: ErrorContext;
  override readonly cause?: Error;

  constructor(message: string, options: BearWatchErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'BearWatchError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
    this.context = options.context;
    this.cause = options.cause;
  }
}

/**
 * Maps HTTP status code to error code.
 */
export function mapStatusToErrorCode(
  status: number,
  body?: { error?: { code?: string } }
): ErrorCode {
  if (status === 401) return 'INVALID_API_KEY';
  if (status === 404) return 'JOB_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';

  // 4xx but not 401/404/429
  const bodyCode = body?.error?.code;
  if (
    bodyCode === 'INVALID_API_KEY' ||
    bodyCode === 'JOB_NOT_FOUND' ||
    bodyCode === 'RATE_LIMITED' ||
    bodyCode === 'SERVER_ERROR' ||
    bodyCode === 'INVALID_RESPONSE' ||
    bodyCode === 'NETWORK_ERROR' ||
    bodyCode === 'TIMEOUT'
  ) {
    return bodyCode;
  }

  return 'SERVER_ERROR';
}
