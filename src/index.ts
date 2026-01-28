// Main client
export { BearWatch } from './bearwatch.js';

// Configuration
export {
  type BearWatchConfig,
  type ResolvedConfig,
  DEFAULT_CONFIG,
  resolveConfig,
} from './config.js';

// Types
export type {
  RequestStatus,
  ResponseStatus,
  Status, // deprecated, kept for backward compatibility
  PingOptions,
  HeartbeatResponse,
} from './types.js';

// Errors
export {
  BearWatchError,
  type ErrorCode,
  type ErrorContext,
  type BearWatchErrorOptions,
  mapStatusToErrorCode,
} from './errors.js';
