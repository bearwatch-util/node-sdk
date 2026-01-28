/**
 * Status values that can be sent in requests.
 * Only these 3 values are valid for ping operations.
 */
export type RequestStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

/**
 * Status values that can be received in responses.
 * Includes server-detected states (TIMEOUT, MISSED).
 */
export type ResponseStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'MISSED';

/**
 * Status of a job run.
 * @deprecated Use RequestStatus for requests, ResponseStatus for responses.
 */
export type Status = ResponseStatus;

/**
 * Options for the ping operation.
 */
export interface PingOptions {
  /** Custom status (default: SUCCESS). Only RUNNING, SUCCESS, FAILED are valid. */
  status?: RequestStatus;
  /** Optional output message */
  output?: string;
  /** Optional error message (for FAILED status) */
  error?: string;
  /** Job start time (ISO 8601 string or Date) */
  startedAt?: Date | string;
  /** Job completion time (ISO 8601 string or Date) */
  completedAt?: Date | string;
  /** Optional metadata (key-value pairs) */
  metadata?: Record<string, unknown>;
  /** Enable/disable retry (default: true) */
  retry?: boolean;
}

/**
 * Response from heartbeat operations.
 */
export interface HeartbeatResponse {
  /** Job ID */
  jobId: string;
  /** Run ID */
  runId: string;
  /** Status of the run (may include server-detected states) */
  status: ResponseStatus;
  /** ISO 8601 timestamp when the server received the heartbeat */
  receivedAt: string;
}
