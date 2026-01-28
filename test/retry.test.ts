import { describe, it, expect } from 'vitest';
import { calculateBackoffDelay, isRetryable } from '../src/internal/retry.js';
import { BearWatchError } from '../src/errors.js';

describe('retry', () => {
  describe('calculateBackoffDelay', () => {
    it('should apply jitter between 0.5 and 1.0', () => {
      const baseDelay = 1000;
      const attempt = 0;

      // Run multiple times to verify jitter is being applied
      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        delays.push(calculateBackoffDelay(attempt, baseDelay));
      }

      // All delays should be between 500ms (1000 * 0.5) and 1000ms (1000 * 1.0)
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(1000);
      }

      // Verify there's actual variation (not all the same value)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('should scale with exponential backoff', () => {
      const baseDelay = 500;

      // Collect samples for each attempt level
      const attempt0Delays: number[] = [];
      const attempt1Delays: number[] = [];
      const attempt2Delays: number[] = [];

      for (let i = 0; i < 50; i++) {
        attempt0Delays.push(calculateBackoffDelay(0, baseDelay));
        attempt1Delays.push(calculateBackoffDelay(1, baseDelay));
        attempt2Delays.push(calculateBackoffDelay(2, baseDelay));
      }

      // Check ranges (baseDelay * 2^attempt * [0.5, 1.0])
      // Attempt 0: 500 * 1 * [0.5, 1.0] = [250, 500]
      for (const d of attempt0Delays) {
        expect(d).toBeGreaterThanOrEqual(250);
        expect(d).toBeLessThanOrEqual(500);
      }

      // Attempt 1: 500 * 2 * [0.5, 1.0] = [500, 1000]
      for (const d of attempt1Delays) {
        expect(d).toBeGreaterThanOrEqual(500);
        expect(d).toBeLessThanOrEqual(1000);
      }

      // Attempt 2: 500 * 4 * [0.5, 1.0] = [1000, 2000]
      for (const d of attempt2Delays) {
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(2000);
      }
    });

    it('should return integer values', () => {
      for (let i = 0; i < 50; i++) {
        const delay = calculateBackoffDelay(0, 500);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });
  });

  describe('isRetryable', () => {
    it('should return true for 5xx status codes', () => {
      const error = new BearWatchError('Server error', { code: 'SERVER_ERROR', statusCode: 500 });
      expect(isRetryable(error)).toBe(true);
    });

    it('should return true for 429 status code', () => {
      const error = new BearWatchError('Rate limited', { code: 'RATE_LIMITED', statusCode: 429 });
      expect(isRetryable(error)).toBe(true);
    });

    it('should return false for 4xx status codes (except 429)', () => {
      const error = new BearWatchError('Not found', { code: 'JOB_NOT_FOUND', statusCode: 404 });
      expect(isRetryable(error)).toBe(false);
    });

    it('should return true for NETWORK_ERROR', () => {
      const error = new BearWatchError('Network error', { code: 'NETWORK_ERROR' });
      expect(isRetryable(error)).toBe(true);
    });

    it('should return true for TIMEOUT', () => {
      const error = new BearWatchError('Timeout', { code: 'TIMEOUT' });
      expect(isRetryable(error)).toBe(true);
    });
  });
});
