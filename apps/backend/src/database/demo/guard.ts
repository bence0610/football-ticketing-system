/**
 * The demo script writes thousands of rows and deletes the ones it wrote last time, so it
 * must never be pointed at a real database. Every condition has to hold; any one that does
 * not stops the script before it connects.
 */
export interface GuardInput {
  /** `process.env.NODE_ENV`. */
  nodeEnv: string | undefined;
  /** The host the data source will actually connect to. */
  dbHost: string | undefined;
  dbName: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Returns the reasons the target is not an acceptable local development database (empty: it is). */
export function guardProblems(input: GuardInput): string[] {
  const problems: string[] = [];
  if (input.nodeEnv !== 'development') {
    problems.push(
      `NODE_ENV is "${input.nodeEnv ?? '(not set)'}"; it must be exactly "development".`,
    );
  }
  if (!isLoopbackHost(input.dbHost)) {
    problems.push(
      `The database host is "${input.dbHost ?? '(not set)'}"; only localhost, 127.x.x.x or ::1 are allowed.`,
    );
  }
  if (!input.dbName || /prod|live|staging/i.test(input.dbName)) {
    problems.push(
      `The database name "${input.dbName ?? '(not set)'}" is missing or looks like a non-development database.`,
    );
  }
  return problems;
}

export function assertLocalDevelopmentDatabase(input: GuardInput): void {
  const problems = guardProblems(input);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to write demo data:\n  - ${problems.join('\n  - ')}\n` +
        'This script only runs against a local development database.',
    );
  }
}
