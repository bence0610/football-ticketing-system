import 'reflect-metadata';
import Redis from 'ioredis';
import { applyTestEnv } from './test-env';

/**
 * Jest `globalTeardown`. We do NOT drop the test database — recreating it
 * from migrations on every run is slow and complicates local debugging.
 * Instead we flush Redis DB 1 so a subsequent run with a different suite
 * does not inherit stale keys. The test tables are truncated per-test via
 * `truncateAll()`.
 */
export default async function globalTeardown(): Promise<void> {
  applyTestEnv();

  const client = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    db: parseInt(process.env.REDIS_DB ?? '1', 10),
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  try {
    await client.flushdb();
  } finally {
    await client.quit();
  }
}
