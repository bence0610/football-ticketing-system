import 'reflect-metadata';
import { createConnection } from 'mysql2/promise';
import Redis from 'ioredis';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { applyTestEnv } from './test-env';

/**
 * Jest `globalSetup`. Runs once before any worker boots.
 *
 * Responsibilities:
 *   1. Materialise the env fixture so DataSource / Redis clients built here
 *      point at the test database and Redis DB.
 *   2. Ensure the `kte_jegyportal_test` database exists.
 *   3. Run all TypeORM migrations so every worker sees a fully migrated
 *      schema when it boots AppModule.
 *   4. Flush Redis DB 1 so the suite starts from a clean slate.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();

  await ensureDatabaseExists();
  await runMigrations();
  await flushRedis();
}

function env(key: string): string {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Missing required test env var: ${key}`);
  }
  return value;
}

async function ensureDatabaseExists(): Promise<void> {
  const connection = await createConnection({
    host: env('DB_HOST'),
    port: parseInt(env('DB_PORT'), 10),
    user: env('DB_USERNAME'),
    password: process.env.DB_PASSWORD ?? '',
    multipleStatements: true,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env('DB_DATABASE')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}

async function runMigrations(): Promise<void> {
  const dataSource = new DataSource({
    type: 'mysql',
    host: env('DB_HOST'),
    port: parseInt(env('DB_PORT'), 10),
    username: env('DB_USERNAME'),
    password: process.env.DB_PASSWORD ?? '',
    database: env('DB_DATABASE'),
    entities: [resolve(__dirname, '../../src/database/entities/*.entity.{ts,js}')],
    migrations: [resolve(__dirname, '../../src/database/migrations/*.{ts,js}')],
    synchronize: false,
    logging: false,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  });

  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({
    host: env('REDIS_HOST'),
    port: parseInt(env('REDIS_PORT'), 10),
    db: parseInt(env('REDIS_DB'), 10),
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  try {
    await client.flushdb();
  } finally {
    await client.quit();
  }
}
