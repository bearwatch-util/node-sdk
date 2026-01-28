import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BearWatch } from '../src/bearwatch.js';
import { BearWatchError } from '../src/errors.js';

describe('BearWatch', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe('ping', () => {
    it('should send a ping request with default options', async () => {
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

      const bw = new BearWatch({ apiKey: 'test-key' });
      const response = await bw.ping('my-job');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bearwatch.dev/api/v1/ingest/jobs/my-job/heartbeat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
          }),
        })
      );

      // Verify body contains required fields
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();

      expect(response.jobId).toBe('my-job');
      expect(response.status).toBe('SUCCESS');
    });

    it('should send a ping with custom status and output', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'FAILED',
            receivedAt: '2026-01-22T10:00:00Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      await bw.ping('my-job', { status: 'FAILED', error: 'Error occurred' });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('FAILED');
      expect(body.error).toBe('Error occurred');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it('should send a ping with startedAt and completedAt auto-set', async () => {
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

      const bw = new BearWatch({ apiKey: 'test-key' });
      await bw.ping('my-job', { status: 'SUCCESS' });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
      // When neither provided, startedAt equals completedAt
      expect(body.startedAt).toBe(body.completedAt);
    });

    it('should send a ping with error message', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'FAILED',
            receivedAt: '2026-01-22T10:00:00Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      await bw.ping('my-job', { status: 'FAILED', error: 'Something went wrong' });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('FAILED');
      expect(body.error).toBe('Something went wrong');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it('should send a ping with startedAt and completedAt as Date', async () => {
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

      const bw = new BearWatch({ apiKey: 'test-key' });
      const startedAt = new Date('2026-01-22T10:00:00Z');
      const completedAt = new Date('2026-01-22T10:00:01Z');
      await bw.ping('my-job', { startedAt, completedAt });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.startedAt).toBe('2026-01-22T10:00:00.000Z');
      expect(body.completedAt).toBe('2026-01-22T10:00:01.000Z');
    });

    it('should throw BearWatchError on 401', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ success: false, error: { message: 'Invalid API key' } }, 401)
      );

      const bw = new BearWatch({ apiKey: 'invalid-key', maxRetries: 0 });

      await expect(bw.ping('my-job', { retry: false })).rejects.toThrow(BearWatchError);
      await expect(bw.ping('my-job', { retry: false })).rejects.toMatchObject({
        code: 'INVALID_API_KEY',
        statusCode: 401,
      });
    });

    it('should throw BearWatchError on 404', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ success: false, error: { message: 'Job not found' } }, 404)
      );

      const bw = new BearWatch({ apiKey: 'test-key', maxRetries: 0 });

      await expect(bw.ping('unknown-job', { retry: false })).rejects.toMatchObject({
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  describe('wrap', () => {
    it('should execute function and send single SUCCESS ping', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:01Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      const fn = vi.fn().mockResolvedValue('result');

      const result = await bw.wrap('my-job', fn);

      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
      // Only ONE HTTP call (no start, just completion)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify request body includes startedAt and completedAt
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('SUCCESS');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it('should execute function and send single FAILED ping on error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'FAILED',
            receivedAt: '2026-01-22T10:00:01Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      const error = new Error('Something went wrong');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(bw.wrap('my-job', fn)).rejects.toThrow('Something went wrong');

      // Only ONE HTTP call
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify fail request body
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(body.status).toBe('FAILED');
      expect(body.error).toBe('Something went wrong');
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it('should preserve original error even when ping() reporting fails', async () => {
      // Mock ping - network error (reporting fails)
      mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

      const bw = new BearWatch({ apiKey: 'test-key', maxRetries: 0 });
      const originalError = new Error('Original business error');
      const fn = vi.fn().mockRejectedValue(originalError);

      // Should throw the ORIGINAL error, not the network error from ping()
      const thrownError = await bw.wrap('my-job', fn).catch((e) => e);

      expect(thrownError).toBe(originalError);
      expect(thrownError.message).toBe('Original business error');
    });

    it('should measure timing accurately', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            jobId: 'my-job',
            runId: 'run-123',
            status: 'SUCCESS',
            receivedAt: '2026-01-22T10:00:01Z',
          },
        })
      );

      const bw = new BearWatch({ apiKey: 'test-key' });
      const delay = 50; // 50ms delay

      const beforeStart = new Date();
      await bw.wrap('my-job', async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return 'done';
      });
      const afterEnd = new Date();

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      // Verify timestamps are present and valid
      const startedAt = new Date(body.startedAt);
      const completedAt = new Date(body.completedAt);

      expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime() - 10);
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterEnd.getTime() + 10);
      // completedAt should be after startedAt by at least the delay
      expect(completedAt.getTime() - startedAt.getTime()).toBeGreaterThanOrEqual(delay - 10);
    });
  });
});
