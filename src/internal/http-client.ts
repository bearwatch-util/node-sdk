import { BearWatchError, mapStatusToErrorCode, type ErrorContext } from '../errors.js';
import type { ResolvedConfig } from '../config.js';
import { withRetry, type BearWatchErrorWithRetry } from './retry.js';

const SDK_VERSION = '0.1.0';
const USER_AGENT = `bearwatch-sdk-node/${SDK_VERSION}`;

export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Enable retry (default: true) */
  retry?: boolean;
  /** Error context for debugging */
  context?: ErrorContext;
}

export interface HttpClient {
  request<T>(path: string, options: RequestOptions): Promise<T>;
}

/**
 * Creates an HTTP client with timeout and retry support.
 */
export function createHttpClient(config: ResolvedConfig): HttpClient {
  return {
    async request<T>(path: string, options: RequestOptions): Promise<T> {
      const shouldRetry = options.retry !== false;
      const url = `${config.baseUrl}${path}`;

      const executeRequest = async (): Promise<T> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('timeout'), config.timeout);

        try {
          const response = await fetch(url, {
            method: options.method,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-API-Key': config.apiKey,
              'User-Agent': USER_AGENT,
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Read response body
          const responseText = await response.text();
          const contentType = response.headers.get('Content-Type');
          const isJson = contentType?.includes('application/json');

          // IMPORTANT: Check HTTP status FIRST (before JSON parsing)
          // This ensures 5xx errors (even with non-JSON body like HTML) are retryable
          if (!response.ok) {
            // For 5xx with non-JSON response (e.g., nginx HTML error page), use SERVER_ERROR
            if (response.status >= 500 && !isJson) {
              const error: BearWatchErrorWithRetry = new BearWatchError(
                `Server error (${response.status})`,
                {
                  code: 'SERVER_ERROR',
                  statusCode: response.status,
                  responseBody: responseText,
                  context: options.context,
                }
              );
              throw error;
            }

            // 429 Rate Limited - JSON 여부와 무관하게 RATE_LIMITED로 처리
            if (response.status === 429) {
              const error: BearWatchErrorWithRetry = new BearWatchError(
                'Rate limit exceeded',
                {
                  code: 'RATE_LIMITED',
                  statusCode: 429,
                  responseBody: responseText,
                  context: options.context,
                }
              );
              error.retryAfter = response.headers.get('Retry-After');
              throw error;
            }

            // For 4xx with non-JSON response, it's an invalid response
            if (!isJson) {
              throw new BearWatchError('Non-JSON response received', {
                code: 'INVALID_RESPONSE',
                statusCode: response.status,
                responseBody: responseText,
                context: options.context,
              });
            }

            // Parse JSON for error details
            let data: unknown;
            try {
              data = JSON.parse(responseText);
            } catch {
              // 5xx면 파싱 실패해도 SERVER_ERROR로 재시도 가능하게
              if (response.status >= 500) {
                throw new BearWatchError(`Server error (${response.status})`, {
                  code: 'SERVER_ERROR',
                  statusCode: response.status,
                  responseBody: responseText,
                  context: options.context,
                });
              }
              throw new BearWatchError('Failed to parse JSON response', {
                code: 'INVALID_RESPONSE',
                statusCode: response.status,
                responseBody: responseText,
                context: options.context,
              });
            }

            const errorCode = mapStatusToErrorCode(
              response.status,
              data as { error?: { code?: string } }
            );

            const errorMessage = getErrorMessage(data) ?? `Request failed with status ${response.status}`;

            const error: BearWatchErrorWithRetry = new BearWatchError(errorMessage, {
              code: errorCode,
              statusCode: response.status,
              responseBody: responseText,
              context: options.context,
            });

            // Attach Retry-After header for 429 responses
            if (response.status === 429) {
              error.retryAfter = response.headers.get('Retry-After');
            }

            throw error;
          }

          // Success response: validate JSON content type
          if (!isJson) {
            throw new BearWatchError('Non-JSON response received', {
              code: 'INVALID_RESPONSE',
              statusCode: response.status,
              responseBody: responseText,
              context: options.context,
            });
          }

          // Parse JSON
          let data: unknown;
          try {
            data = JSON.parse(responseText);
          } catch {
            throw new BearWatchError('Failed to parse JSON response', {
              code: 'INVALID_RESPONSE',
              statusCode: response.status,
              responseBody: responseText,
              context: options.context,
            });
          }

          // Extract data from ApiResponse wrapper
          const apiResponse = data as { success: boolean; data?: T; error?: { message?: string } };
          if (apiResponse.success === false) {
            throw new BearWatchError(apiResponse.error?.message ?? 'Request failed', {
              code: 'SERVER_ERROR',
              statusCode: response.status,
              responseBody: responseText,
              context: options.context,
            });
          }

          return apiResponse.data as T;
        } catch (error) {
          clearTimeout(timeoutId);

          if (error instanceof BearWatchError) {
            throw error;
          }

          // AbortError 처리: 타임아웃 vs 사용자 취소 구분
          if (error instanceof Error && error.name === 'AbortError') {
            // controller.abort('timeout')으로 호출된 경우 내부 타임아웃
            if (controller.signal.reason === 'timeout') {
              throw new BearWatchError(`Request timed out after ${config.timeout}ms`, {
                code: 'TIMEOUT',
                context: options.context,
                cause: error,
              });
            }
            // 사용자 취소는 원본 AbortError 그대로 전파
            throw error;
          }

          // Handle network errors
          if (error instanceof TypeError) {
            throw new BearWatchError('Network error', {
              code: 'NETWORK_ERROR',
              context: options.context,
              cause: error,
            });
          }

          // Unknown error
          throw new BearWatchError('Unknown error occurred', {
            code: 'NETWORK_ERROR',
            context: options.context,
            cause: error instanceof Error ? error : undefined,
          });
        }
      };

      if (shouldRetry) {
        return withRetry(executeRequest, {
          maxRetries: config.maxRetries,
          baseDelay: config.retryDelay,
        });
      }

      return executeRequest();
    },
  };
}

function getErrorMessage(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (typeof obj['message'] === 'string') {
      return obj['message'];
    }
    if (typeof obj['error'] === 'object' && obj['error'] !== null) {
      const error = obj['error'] as Record<string, unknown>;
      if (typeof error['message'] === 'string') {
        return error['message'];
      }
    }
  }
  return undefined;
}
