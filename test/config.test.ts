import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('resolveConfig', () => {
  it('should use default values when not provided', () => {
    const config = resolveConfig({ apiKey: 'test-key' });

    expect(config.apiKey).toBe('test-key');
    expect(config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(config.timeout).toBe(DEFAULT_CONFIG.timeout);
    expect(config.maxRetries).toBe(DEFAULT_CONFIG.maxRetries);
    expect(config.retryDelay).toBe(DEFAULT_CONFIG.retryDelay);
  });

  it('should override default values with user-provided values', () => {
    const config = resolveConfig({
      apiKey: 'test-key',
      baseUrl: 'https://custom.api.com',
      timeout: 60000,
      maxRetries: 5,
      retryDelay: 1000,
    });

    expect(config.apiKey).toBe('test-key');
    expect(config.baseUrl).toBe('https://custom.api.com');
    expect(config.timeout).toBe(60000);
    expect(config.maxRetries).toBe(5);
    expect(config.retryDelay).toBe(1000);
  });

  it('should allow partial overrides', () => {
    const config = resolveConfig({
      apiKey: 'test-key',
      timeout: 10000,
    });

    expect(config.apiKey).toBe('test-key');
    expect(config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(config.timeout).toBe(10000);
    expect(config.maxRetries).toBe(DEFAULT_CONFIG.maxRetries);
    expect(config.retryDelay).toBe(DEFAULT_CONFIG.retryDelay);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_CONFIG.baseUrl).toBe('https://api.bearwatch.dev');
    expect(DEFAULT_CONFIG.timeout).toBe(30000);
    expect(DEFAULT_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_CONFIG.retryDelay).toBe(500);
  });
});
