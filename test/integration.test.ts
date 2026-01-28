import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BearWatch } from '../src/bearwatch.js';
import { BearWatchError } from '../src/errors.js';

/**
 * Integration tests using a mock server simulation.
 * These tests verify the complete request/response flow.
 */
describe('Integration', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockResponse(data: unknown, options?: { status?: number; headers?: Record<string, string> }) {
    const status = options?.status ?? 200;
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...options?.headers,
    });

    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe('complete flow: wrap with timing', () => {
    it('should complete a full job execution cycle with timestamps', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'daily-backup',
            runId: 'run-abc-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:30Z',
          },
        })
      );

      const bw = new BearWatch({
        apiKey: 'bw_live_abc123',
        baseUrl: 'https://api.bearwatch.dev',
      });

      // Simulate a job execution with wrap
      const result = await bw.wrap('daily-backup', async () => {
        // Simulate work
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return 'Backup completed successfully';
      });

      expect(result).toBe('Backup completed successfully');

      // Verify single API call
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify request includes timing info
      expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.bearwatch.dev/api/v1/ingest/jobs/daily-backup/heartbeat');
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
      // Duration should be at least 10ms (completedAt - startedAt)
      const duration = new Date(body.completedAt).getTime() - new Date(body.startedAt).getTime();
      expect(duration).toBeGreaterThanOrEqual(10);
    });
  });

  describe('manual timing with ping', () => {
    it('should send ping with manual timestamps', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:30Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });

      // Simulate manual timing
      const startedAt = new Date();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const completedAt = new Date();

      await bw.ping('my-job', {
        status: 'SUCCESS',
        startedAt,
        completedAt,
        output: 'Processed 100 items',
      });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(body.startedAt).toBe(startedAt.toISOString());
      expect(body.completedAt).toBe(completedAt.toISOString());
      expect(body.output).toBe('Processed 100 items');
    });
  });

  describe('error handling: 429 rate limit', () => {
    it('should handle 429 with Retry-After header', async () => {
      // First call returns 429
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          { success: false, error: { message: 'Rate limit exceeded' } },
          { status: 429, headers: { 'Retry-After': '1' } }
        )
      );

      // Second call succeeds
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:00Z',
          },
        })
      );

      const bw = new BearWatch({
        apiKey: 'test-key',
        maxRetries: 1,
        retryDelay: 100, // Short delay for test
      });

      const startTime = Date.now();
      const response = await bw.ping('my-job');
      const elapsed = Date.now() - startTime;

      expect(response.status).toBe('SUCCESS');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Should have waited at least the Retry-After time (1 second = 1000ms)
      expect(elapsed).toBeGreaterThanOrEqual(900); // Allow some timing variance
    });
  });

  describe('error handling: 5xx HTML response', () => {
    it('should retry on 5xx with non-JSON response (e.g., nginx HTML error)', async () => {
      // First call returns 502 with HTML (nginx error page)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({ 'Content-Type': 'text/html' }),
        text: () => Promise.resolve('<html><body>Bad Gateway</body></html>'),
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:00Z',
          },
        })
      );

      const bw = new BearWatch({
        apiKey: 'test-key',
        maxRetries: 1,
        retryDelay: 10, // Short delay for test
      });

      const response = await bw.ping('my-job');

      expect(response.status).toBe('SUCCESS');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should classify 5xx HTML as SERVER_ERROR (retryable)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'Content-Type': 'text/html' }),
        text: () => Promise.resolve('<html><body>Service Unavailable</body></html>'),
      });

      const bw = new BearWatch({
        apiKey: 'test-key',
        maxRetries: 0,
      });

      const error = await bw.ping('my-job', { retry: false }).catch((e) => e);

      expect(error).toBeInstanceOf(BearWatchError);
      expect(error.code).toBe('SERVER_ERROR'); // Not INVALID_RESPONSE
      expect(error.statusCode).toBe(503);
    });
  });

  describe('error handling: 401 unauthorized', () => {
    it('should not retry on 401 and throw appropriate error', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(
          { success: false, error: { message: 'Invalid API key' } },
          { status: 401 }
        )
      );

      const bw = new BearWatch({
        apiKey: 'invalid-key',
        maxRetries: 3, // Should not retry
      });

      await expect(bw.ping('my-job', { retry: false })).rejects.toMatchObject({
        code: 'INVALID_API_KEY',
        statusCode: 401,
      });

      // Should only be called once (no retries for 401)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling: network error', () => {
    it('should wrap network errors in BearWatchError', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const bw = new BearWatch({
        apiKey: 'test-key',
        maxRetries: 0,
      });

      const error = await bw.ping('my-job', { retry: false }).catch((e) => e);

      expect(error).toBeInstanceOf(BearWatchError);
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.cause).toBeInstanceOf(TypeError);
    });
  });

  describe('error handling: abort (user cancellation)', () => {
    it('should propagate AbortError as-is when user cancels', async () => {
      mockFetch.mockImplementation(() => {
        const controller = new AbortController();
        controller.abort();
        throw new DOMException('The operation was aborted', 'AbortError');
      });

      const bw = new BearWatch({
        apiKey: 'test-key',
        timeout: 100,
        maxRetries: 0,
      });

      const error = await bw.ping('my-job', { retry: false }).catch((e) => e);

      // AbortError는 사용자의 의도적 취소이므로 원본 그대로 전파됨
      expect(error).toBeInstanceOf(DOMException);
      expect(error.name).toBe('AbortError');
    });
  });

  describe('error handling: timeout', () => {
    it('should throw BearWatchError with TIMEOUT code on request timeout', async () => {
      // Simulate slow response that triggers timeout
      mockFetch.mockImplementation(
        (_url: string, options: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            // Listen for abort signal
            options?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
            // Never resolve - will be aborted by timeout
          })
      );

      const bw = new BearWatch({
        apiKey: 'test-key',
        timeout: 50, // 50ms timeout
        maxRetries: 0,
      });

      const error = await bw.ping('my-job', { retry: false }).catch((e) => e);

      // 타임아웃은 BearWatchError with TIMEOUT 코드로 래핑
      expect(error).toBeInstanceOf(BearWatchError);
      expect(error.code).toBe('TIMEOUT');
      expect(error.message).toContain('timed out');
    });

    it('should retry on timeout when retries are enabled', async () => {
      let attempts = 0;

      mockFetch.mockImplementation(
        (_url: string, options: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            attempts++;
            if (attempts < 3) {
              // First two attempts timeout
              options?.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted', 'AbortError'));
              });
            } else {
              // Third attempt succeeds immediately
              resolve({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: () =>
                  Promise.resolve(
                    JSON.stringify({
                      success: true,
                      data: {
                        jobId: 'my-job',
                        runId: 'run-123',
                        status: 'SUCCESS',
                        receivedAt: new Date().toISOString(),
                      },
                    })
                  ),
              });
            }
          })
      );

      const bw = new BearWatch({
        apiKey: 'test-key',
        timeout: 50,
        maxRetries: 3,
        retryDelay: 10,
      });

      const response = await bw.ping('my-job');

      expect(response.status).toBe('SUCCESS');
      expect(attempts).toBe(3); // 2 timeouts + 1 success
    });
  });

  describe('wrap helper', () => {
    it('should handle successful execution with single HTTP call', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: { jobId: 'my-job', runId: 'run-123', status: 'SUCCESS', receivedAt: '2026-01-22T10:00:01Z' },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });

      const result = await bw.wrap('my-job', async () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(typeof body.startedAt).toBe('string');
      expect(typeof body.completedAt).toBe('string');
    });

    it('should handle failed execution with single HTTP call', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: { jobId: 'my-job', runId: 'run-123', status: 'FAILED', receivedAt: '2026-01-22T10:00:01Z' },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      const originalError = new Error('Job failed!');

      await expect(
        bw.wrap('my-job', async () => {
          throw originalError;
        })
      ).rejects.toThrow('Job failed!');

      // Verify only one call (fail)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('FAILED');
      expect(body.error).toBe('Job failed!');
      expect(typeof body.startedAt).toBe('string');
      expect(typeof body.completedAt).toBe('string');
    });
  });

  describe('API key header', () => {
    it('should send X-API-Key header', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: { jobId: 'my-job', runId: 'run-123', status: 'SUCCESS', receivedAt: '2026-01-22T10:00:00Z' },
        })
      );

      const bw = new BearWatch({ apiKey: 'bw_live_secret123' });
      await bw.ping('my-job');

      const headers = mockFetch.mock.calls[0]?.[1]?.headers;
      expect(headers['X-API-Key']).toBe('bw_live_secret123');
    });
  });
});
