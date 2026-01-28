/**
 * Configuration for BearWatch client.
 */
export interface BearWatchConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL of the BearWatch API (default: https://api.bearwatch.dev) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 500) */
  retryDelay?: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG = {
  baseUrl: 'https://api.bearwatch.dev',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 500,
} as const;

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
}

/**
 * Resolves user config with defaults.
 */
export function resolveConfig(config: BearWatchConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
  };
}
