#!/usr/bin/env node
/**
 * Orchestrates the E2E suite:
 *   1. docker compose up (--wait for healthy containers)
 *   2. npm run test:e2e in apps/backend
 *   3. docker compose down -v  (always, even on test failure)
 *
 * Exits with the test suite's exit code so CI fails when tests fail.
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const opts = { stdio: 'inherit', cwd: root };

let exitCode = 0;

try {
  execSync('docker compose -f docker-compose.test.yml up -d --wait', opts);
  execSync('npm run test:e2e:run', opts);
} catch (err) {
  exitCode = (err && err.status) || 1;
} finally {
  try {
    execSync('docker compose -f docker-compose.test.yml down -v', opts);
  } catch (downErr) {
    process.stderr.write(`Warning: docker compose down failed: ${downErr.message}\n`);
    if (exitCode === 0) exitCode = 1;
  }
}

process.exit(exitCode);
