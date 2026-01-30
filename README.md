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

### 1. Get API Key

Go to [BearWatch Dashboard](https://bearwatch.dev) → Project Settings → Create API Key (e.g., `bw_kI6t8QA21on0DKeRDlen8r2hzucVNL3WdAfaZgQdetY`).

### 2. Create a Job

Create a job in the dashboard. You'll get a job ID (24-character hex string, e.g., `507f1f77bcf86cd799439011`).

### 3. Install and Use

Let's assume you have a daily backup job that runs at 2:00 AM:

```typescript
// cron-jobs.ts
import cron from 'node-cron';
import { BearWatch } from '@bearwatch/sdk';

const bw = new BearWatch({ apiKey: 'your-api-key' });

cron.schedule('0 0 2 * * *', async () => {
  await bw.wrap('507f1f77bcf86cd799439011', async () => {
    await backup();
  });
});
```

## Usage

### ping - Manual Status Reporting

Use `ping` when you need fine-grained control over status reporting:

```typescript
cron.schedule('0 0 2 * * *', async () => {
  try {
    await backup();
    await bw.ping('507f1f77bcf86cd799439011', { status: 'SUCCESS' });
  } catch (error) {
    await bw.ping('507f1f77bcf86cd799439011', {
      status: 'FAILED',
      error: error instanceof Error ? (error.stack || error.message) : String(error),
    });
  }
});
```

Include output and metadata:

```typescript
cron.schedule('0 0 0 * * *', async () => {
  const bytes = await backup();
  await bw.ping('507f1f77bcf86cd799439011', {
    status: 'SUCCESS',
    output: `Backup completed: ${bytes} bytes`,
    metadata: { bytes },
  });
});
```

#### PingOptions

| Option        | Type                      | Default        | Description                              |
| ------------- | ------------------------- | -------------- | ---------------------------------------- |
| `status`      | `RequestStatus`           | `'SUCCESS'`    | `'RUNNING'`, `'SUCCESS'`, or `'FAILED'`  |
| `output`      | `string`                  | -              | Output message (max 10KB)                |
| `error`       | `string`                  | -              | Error message for `FAILED` status (max 75KB) |
| `startedAt`   | `Date \| string`          | `completedAt`  | Job start time                           |
| `completedAt` | `Date \| string`          | current time   | Job completion time                      |
| `metadata`    | `Record<string, unknown>` | -              | Additional key-value pairs (max 10KB)    |
| `retry`       | `boolean`                 | `true`         | Enable/disable retry                     |

> **Note**: `TIMEOUT` and `MISSED` are server-detected states and cannot be set in requests.

> **Size Limits**: The `output` and `metadata` fields have a 10KB size limit each, while the `error` field has a 75KB size limit. If exceeded, the server automatically truncates the data (no error is returned). For `output` and `error`, strings are truncated to fit within the limit. For `metadata`, if the serialized JSON exceeds 10KB, the entire field is set to `null`.

### wrap - Automatic Status Reporting

Wraps a function and automatically:
- Measures `startedAt` and `completedAt`
- Reports `SUCCESS` or `FAILED` based on whether the function completes or throws

```typescript
cron.schedule('0 0 2 * * *', async () => {
  await bw.wrap('507f1f77bcf86cd799439011', async () => {
    await backup();
  });
});
```

Include metadata:

```typescript
cron.schedule('0 0 2 * * *', async () => {
  await bw.wrap('507f1f77bcf86cd799439011', async () => {
    await backup();
  }, {
    metadata: {
      server: 'backup-01',
      region: 'ap-northeast-2',
      version: '1.2.0',
    },
  });
});
```

#### WrapOptions

| Option     | Type                      | Default | Description                           |
| ---------- | ------------------------- | ------- | ------------------------------------- |
| `metadata` | `Record<string, unknown>` | -       | Additional key-value pairs (max 10KB) |
| `retry`    | `boolean`                 | `true`  | Enable/disable retry                  |

> **Size Limits**: The `metadata` field has a 10KB size limit. If exceeded, the server automatically truncates the data (no error is returned). If the serialized JSON exceeds 10KB, the entire field is set to `null`. When errors occur, the error message captured by `wrap` has a 75KB limit and will be truncated if exceeded.

**Error handling behavior:**
- On success: reports `SUCCESS` with execution duration
- On error: reports `FAILED` with error message, then **re-throws the original error**

```typescript
cron.schedule('0 0 2 * * *', async () => {
  try {
    await bw.wrap('507f1f77bcf86cd799439011', async () => {
      await backup();
    });
  } catch (error) {
    // BearWatch already reported FAILED status
    // You can add additional error handling here
    console.error(error);
  }
});
```

> **Tip**: Use `wrap` for most cases. Use `ping` when you need more control (e.g., reporting RUNNING status for long jobs).

## Configuration

```typescript
const bw = new BearWatch({
  apiKey: 'your-api-key',

  // Optional (defaults shown)
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 500, // 500ms base delay
});
```

| Option       | Type     | Required | Default  | Description               |
| ------------ | -------- | -------- | -------- | ------------------------- |
| `apiKey`     | `string` | Yes      | -        | API key for authentication |
| `timeout`    | `number` | No       | `30000`  | Request timeout (ms)      |
| `maxRetries` | `number` | No       | `3`      | Max retry attempts        |
| `retryDelay` | `number` | No       | `500`    | Initial retry delay (ms)  |

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
await bw.ping('507f1f77bcf86cd799439011', { retry: false });
```

## Error Handling

When the SDK fails to communicate with BearWatch (network failure, server down, invalid API key, etc.), it throws a `BearWatchError`:

```typescript
import { BearWatch, BearWatchError } from '@bearwatch/sdk';

try {
  await bw.ping('507f1f77bcf86cd799439011');
} catch (error) {
  if (error instanceof BearWatchError) {
    // SDK failed to report to BearWatch
    console.error(`Code: ${error.code}`);
    console.error(`Status: ${error.statusCode}`);
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

## TypeScript

The SDK is written in TypeScript and includes full type definitions:

```typescript
import {
  BearWatch,
  BearWatchConfig,
  BearWatchError,
  ErrorCode,
  ErrorContext,
  HeartbeatResponse,
  PingOptions,
  WrapOptions,
  RequestStatus,   // For requests: 'RUNNING' | 'SUCCESS' | 'FAILED'
  ResponseStatus,  // For responses: includes 'TIMEOUT' | 'MISSED'
  Status,          // Alias for ResponseStatus (deprecated)
} from '@bearwatch/sdk';
```

### Method Signatures

```typescript
class BearWatch {
  constructor(config: BearWatchConfig);
  ping(jobId: string, options?: PingOptions): Promise<HeartbeatResponse>;
  wrap<T>(jobId: string, fn: () => Promise<T>, options?: WrapOptions): Promise<T>;
}
```

### HeartbeatResponse

```typescript
interface HeartbeatResponse {
  jobId: string;      // Job ID
  runId: string;      // Unique run ID for this execution
  status: ResponseStatus;
  receivedAt: string; // ISO 8601 timestamp
}
```

## Common Patterns

### node-cron

```typescript
import cron from 'node-cron';
import { BearWatch } from '@bearwatch/sdk';

const bw = new BearWatch({ apiKey: 'your-api-key' });

// Every day at 3:00 AM
cron.schedule('0 0 3 * * *', async () => {
  await bw.wrap('6848c9e5f8a2b3d4e5f60001', async () => {
    await backup();
  });
});
```

### AWS Lambda (EventBridge Scheduler)

```typescript
import { BearWatch } from '@bearwatch/sdk';

const bw = new BearWatch({ apiKey: process.env.BEARWATCH_API_KEY });

export const handler = async () => {
  await bw.wrap('6848c9e5f8a2b3d4e5f60002', async () => {
    await backup();
  });
};
```

### Long-Running Jobs

```typescript
async function runBackup() {
  const jobId = '6848c9e5f8a2b3d4e5f60003';
  const startedAt = new Date();

  await bw.ping(jobId, { status: 'RUNNING' });

  try {
    await backup();
    await bw.ping(jobId, {
      status: 'SUCCESS',
      startedAt,
      completedAt: new Date(),
    });
  } catch (error) {
    await bw.ping(jobId, {
      status: 'FAILED',
      startedAt,
      completedAt: new Date(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

## FAQ

**Q: Do I need to create jobs in the dashboard first?**
A: Yes, create a job in the [BearWatch Dashboard](https://bearwatch.dev) first to get a job ID.

**Q: What's the difference between `wrap` and `ping`?**
A: `wrap` automatically measures execution time and reports SUCCESS/FAILED based on whether the function completes or throws. `ping` gives you manual control over when and what to report.

**Q: What happens if the SDK fails to report (network error)?**
A: By default, the SDK retries 3 times with exponential backoff. If all retries fail, `ping` throws a `BearWatchError`. For `wrap`, the original function's error takes priority and is always re-thrown.

## Troubleshooting

**"Cannot use import statement outside a module"**
This SDK is ESM only. Add `"type": "module"` to your `package.json`.

**"fetch is not defined"**
Requires Node.js 18.0.0 or higher which includes native `fetch`.

**"JOB_NOT_FOUND" error**
Create the job in the [BearWatch Dashboard](https://bearwatch.dev) first. The job ID must exist before sending pings.

## CommonJS Support

This package is **ESM only** and does not support CommonJS (`require()`).

If you need CommonJS support, please open an issue. CommonJS support may be added in a future version.

## License

MIT
