import {
  type BearWatchConfig,
  type ResolvedConfig,
  resolveConfig,
} from './config.js';
import { createHttpClient, type HttpClient } from './internal/http-client.js';
import type {
  HeartbeatResponse,
  PingOptions,
  WrapOptions,
} from './types.js';

/**
 * BearWatch client for job monitoring.
 *
 * @example
 * ```typescript
 * import { BearWatch } from '@bearwatch/sdk';
 *
 * const bw = new BearWatch({ apiKey: 'your-api-key' });
 *
 * // Simple ping
 * await bw.ping('my-job');
 *
 * // Using wrap for automatic timing and reporting
 * await bw.wrap('my-job', async () => {
 *   await doWork();
 * });
 *
 * // Manual timing control
 * const startedAt = new Date();
 * await doWork();
 * await bw.ping('my-job', {
 *   status: 'SUCCESS',
 *   startedAt,
 *   completedAt: new Date(),
 *   output: 'Done!'
 * });
 * ```
 */
export class BearWatch {
  private readonly config: ResolvedConfig;
  private readonly http: HttpClient;

  /**
   * Creates a new BearWatch client.
   *
   * @param config - Client configuration
   */
  constructor(config: BearWatchConfig) {
    this.config = resolveConfig(config);
    this.http = createHttpClient(this.config);
  }

  /**
   * Sends a heartbeat ping for a job.
   *
   * This is the primary way to report job execution status.
   * startedAt and completedAt are required by the server (auto-set to now if not provided).
   *
   * @param jobId - The job identifier
   * @param options - Optional ping options
   * @returns Heartbeat response from the server
   *
   * @example
   * ```typescript
   * // Simple success ping (startedAt/completedAt auto-set to now)
   * await bw.ping('my-job');
   *
   * // Ping with output
   * await bw.ping('my-job', { output: 'Processed 100 items' });
   *
   * // Report failure
   * await bw.ping('my-job', { status: 'FAILED', error: 'Error occurred' });
   *
   * // With manual timing
   * const startedAt = new Date();
   * await doWork();
   * await bw.ping('my-job', {
   *   status: 'SUCCESS',
   *   startedAt,
   *   completedAt: new Date(),
   * });
   * ```
   */
  async ping(jobId: string, options?: PingOptions): Promise<HeartbeatResponse> {
    const now = new Date().toISOString();

    // Convert dates to ISO strings
    const completedAt = options?.completedAt !== undefined
      ? (options.completedAt instanceof Date ? options.completedAt.toISOString() : options.completedAt)
      : now;
    const startedAt = options?.startedAt !== undefined
      ? (options.startedAt instanceof Date ? options.startedAt.toISOString() : options.startedAt)
      : completedAt;

    const body: Record<string, unknown> = {
      status: options?.status ?? 'SUCCESS',
      startedAt,
      completedAt,
    };

    if (options?.output !== undefined) {
      body.output = options.output;
    }
    if (options?.error !== undefined) {
      body.error = options.error;
    }
    if (options?.metadata !== undefined) {
      body.metadata = options.metadata;
    }

    return this.http.request<HeartbeatResponse>(`/api/v1/ingest/jobs/${jobId}/heartbeat`, {
      method: 'POST',
      body,
      retry: options?.retry !== false, // Default: true
      context: { jobId, operation: 'ping' },
    });
  }

  /**
   * Wraps a function with automatic heartbeat reporting.
   *
   * Automatically measures execution time and reports SUCCESS or FAILED
   * based on whether the function completes normally or throws an error.
   * Makes a single HTTP call after execution completes.
   *
   * @param jobId - The job identifier
   * @param fn - Async function to execute
   * @param options - Optional wrap options (metadata, retry)
   * @returns Result of the function
   *
   * @example
   * ```typescript
   * const result = await bw.wrap('my-job', async () => {
   *   const data = await fetchData();
   *   await processData(data);
   *   return data.length;
   * });
   *
   * // With metadata
   * await bw.wrap('my-job', async () => {
   *   await backup();
   * }, { metadata: { server: 'backup-01' } });
   * ```
   */
  async wrap<T>(jobId: string, fn: () => Promise<T>, options?: WrapOptions): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await fn();
      await this.ping(jobId, {
        status: 'SUCCESS',
        startedAt,
        completedAt: new Date(),
        metadata: options?.metadata,
        retry: options?.retry,
      });
      return result;
    } catch (error) {
      // Wrap ping() in try-catch to ensure original error is always preserved
      // Even if reporting fails (network error, etc.), we still throw the original error
      try {
        await this.ping(jobId, {
          status: 'FAILED',
          startedAt,
          completedAt: new Date(),
          error: error instanceof Error ? (error.stack || error.message) : String(error),
          metadata: options?.metadata,
          retry: options?.retry,
        });
      } catch {
        // Ignore reporting failure - original error takes priority
      }
      throw error; // Always re-throw original error
    }
  }
}
