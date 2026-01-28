# @bearwatch/sdk

Official BearWatch SDK for Node.js - Job monitoring and alerting for indie developers.

## Installation

```bash
npm install @bearwatch/sdk
```

## Requirements

- **Node.js 18.0.0 or higher** (uses native `fetch`)
- **ESM only** - CommonJS is not supported

## Quick Start

```typescript
import { BearWatch } from '@bearwatch/sdk';

const bw = new BearWatch({
  apiKey: 'your-api-key',
});

// Simple ping
await bw.ping('my-job');

// Ping with status and output
await bw.ping('my-job', {
  status: 'SUCCESS',
  output: 'Processed 100 items',
});
```

## Usage

### Simple Ping

For simple jobs that just need to report they ran:

```typescript
await bw.ping('my-job');

// Report failure with error message
await bw.ping('my-job', {
  status: 'FAILED',
  error: 'Database connection failed',
});
```

### Ping with Options

Include additional details with your heartbeat:

```typescript
await bw.ping('my-job', {
  status: 'SUCCESS',
  output: 'Processed 100 records',
  metadata: { recordCount: 100, source: 'postgres' },
});

// With manual timing
const startedAt = new Date();
await doWork();
await bw.ping('my-job', {
  status: 'SUCCESS',
  startedAt,
  completedAt: new Date(),
});
```

#### PingOptions

| Option        | Type                   | Description                              |
| ------------- | ---------------------- | ---------------------------------------- |
| `status`      | `RequestStatus`        | Job status: `'RUNNING'`, `'SUCCESS'`, `'FAILED'` (default: `'SUCCESS'`) |
| `output`      | `string`               | Output message                           |
| `error`       | `string`               | Error message (for `FAILED` status)      |
| `startedAt`   | `Date \| string`       | Job start time (auto-set if not provided)|
| `completedAt` | `Date \| string`       | Job completion time (auto-set if not provided) |
| `metadata`    | `Record<string, unknown>` | Additional key-value pairs            |
| `retry`       | `boolean`              | Enable/disable retry (default: `true`)   |

> **Note**: `TIMEOUT` and `MISSED` are server-detected states and cannot be set in requests. They appear only in `ResponseStatus`.

### Wrap Helper

Automatically measures execution time and reports success or failure:

```typescript
const result = await bw.wrap('my-job', async () => {
  const data = await fetchData();
  await processData(data);
  return data.length;
});
```

## Configuration

```typescript
const bw = new BearWatch({
  // Required
  apiKey: 'your-api-key',

  // Optional (defaults shown)
  baseUrl: 'https://api.bearwatch.dev',
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 500, // 500ms base delay
});
```

## Retry Policy

| Method   | Default Retry | Reason                   |
| -------- | ------------- | ------------------------ |
| `ping()` | Enabled       | Idempotent operation     |
| `wrap()` | Enabled       | Uses ping() internally   |

### Retry Behavior

- **Exponential backoff**: 500ms → 1000ms → 2000ms
- **429 Rate Limit**: Respects `Retry-After` header
- **5xx Server Errors**: Retries with backoff
- **401/404**: No retry (client errors)

### Disable Retry

```typescript
// Disable retry for a specific call
await bw.ping('my-job', { retry: false });
```

## Error Handling

```typescript
import { BearWatch, BearWatchError } from '@bearwatch/sdk';

try {
  await bw.ping('my-job');
} catch (error) {
  if (error instanceof BearWatchError) {
    console.error(`Code: ${error.code}`);
    console.error(`Status: ${error.statusCode}`);
    console.error(`Context: ${JSON.stringify(error.context)}`);

    // Original error (if any)
    if (error.cause) {
      console.error(`Cause: ${error.cause.message}`);
    }
  }
}
```

### Error Codes

| Code              | Description              | Retry   |
| ----------------- | ------------------------ | ------- |
| `INVALID_API_KEY` | 401 - Invalid API key    | No      |
| `JOB_NOT_FOUND`   | 404 - Job not found      | No      |
| `RATE_LIMITED`    | 429 - Rate limit reached | Yes     |
| `SERVER_ERROR`    | 5xx - Server error       | Yes     |
| `NETWORK_ERROR`   | Network failure          | Yes     |
| `TIMEOUT`         | Request timed out        | Yes     |
| `INVALID_RESPONSE`| Non-JSON response        | No      |

## TypeScript

The SDK is written in TypeScript and includes type definitions:

```typescript
import {
  BearWatch,
  BearWatchConfig,
  BearWatchError,
  ErrorCode,
  ErrorContext,
  HeartbeatResponse,
  PingOptions,
  RequestStatus,   // For requests: 'RUNNING' | 'SUCCESS' | 'FAILED'
  ResponseStatus,  // For responses: includes 'TIMEOUT' | 'MISSED'
  Status,          // Alias for ResponseStatus (deprecated)
} from '@bearwatch/sdk';
```

## CommonJS Support

This package is **ESM only** and does not support CommonJS (`require()`).

If you need CommonJS support, please open an issue. CommonJS support may be added in a future version.

## License

MIT
