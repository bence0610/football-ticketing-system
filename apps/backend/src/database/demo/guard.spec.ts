import { assertLocalDevelopmentDatabase, guardProblems, isLoopbackHost } from './guard';

describe('demo seed guard', () => {
  const ok = { nodeEnv: 'development', dbHost: 'localhost', dbName: 'kte_jegyportal' };

  it('accepts a local development database', () => {
    expect(guardProblems(ok)).toEqual([]);
    expect(() => assertLocalDevelopmentDatabase(ok)).not.toThrow();
  });

  it.each(['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'LOCALHOST'])(
    'treats %s as this machine',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    'db.example.com',
    '10.0.0.5',
    '192.168.1.20',
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    '',
    undefined,
  ])('refuses the host %s', (host) => {
    expect(guardProblems({ ...ok, dbHost: host })).toHaveLength(1);
    expect(() => assertLocalDevelopmentDatabase({ ...ok, dbHost: host })).toThrow(/Refusing/);
  });

  it.each(['production', 'test', 'staging', '', undefined])('refuses NODE_ENV=%s', (env) => {
    expect(guardProblems({ ...ok, nodeEnv: env })).toHaveLength(1);
  });

  it.each(['kte_prod', 'production_db', 'kte_live', 'staging', '', undefined])(
    'refuses the database name %s',
    (name) => {
      expect(guardProblems({ ...ok, dbName: name })).toHaveLength(1);
    },
  );

  it('reports every problem at once, and throws before anything is written', () => {
    const problems = guardProblems({
      nodeEnv: 'production',
      dbHost: 'db.example.com',
      dbName: 'prod',
    });
    expect(problems).toHaveLength(3);
  });
});
