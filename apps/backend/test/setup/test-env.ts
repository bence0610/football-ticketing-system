/**
 * Shared environment-variable fixture for the E2E suite.
 *
 * Applied twice:
 *   1. In Jest's `globalSetup` so one-time infrastructure (migrations,
 *      Redis flush) runs against the right database and Redis DB.
 *   2. At the top of every spec file (via `import './setup/test-env'` or
 *      `applyTestEnv()`) because Jest spawns a fresh Node worker per test
 *      file and `globalSetup` env mutations do not propagate to workers.
 */

export const TEST_WEBHOOK_SECRET = 'whsec_test_signing_secret_for_e2e';

export const TEST_ENV: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'test',
  PORT: '3001',
  APP_URL: 'http://localhost:3001',
  FRONTEND_URL: 'http://localhost:4200',
  CORS_ORIGINS: 'http://localhost:4200',
  HOME_TEAM_NAME: 'Kecskeméti TE',

  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_USERNAME: 'root',
  DB_PASSWORD: 'testroot',
  DB_DATABASE: 'kte_jegyportal_test',
  DB_SYNCHRONIZE: 'false',
  DB_LOGGING: 'false',

  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6380',
  REDIS_DB: '1',
  REDIS_KEY_PREFIX: 'kte-e2e:',

  SEAT_LOCK_TTL_SECONDS: '300',

  JWT_ACCESS_SECRET: 'test-access-secret-min-16-chars',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'test-refresh-secret-min-16-chars',
  JWT_REFRESH_EXPIRES_IN: '7d',
  BCRYPT_ROUNDS: '10',

  STRIPE_SECRET_KEY: 'sk_test_placeholder_for_e2e_tests',
  STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  STRIPE_CURRENCY: 'huf',

  ANTHROPIC_API_KEY: 'test-anthropic-key',

  SMTP_HOST: 'localhost',
  SMTP_PORT: '25',
  SMTP_USER: 'test@test.com',
  SMTP_PASS: '',
  SMTP_FROM: 'test@test.com',
  EMAIL_BASE_URL: 'http://localhost:3001',

  QR_SIGNING_SECRET: 'test-qr-signing-secret-min-16',

  LOG_LEVEL: 'error',
});

/**
 * Idempotent — safe to call from any place that may be loaded before the
 * ConfigModule validates. Each key is only set if currently unset so a
 * user running the tests with custom overrides (e.g. a non-default
 * DB_HOST) is respected.
 */
export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

applyTestEnv();
