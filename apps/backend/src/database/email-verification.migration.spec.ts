import { EmailVerification1716500000000 } from './migrations/1716500000000-EmailVerification';

describe('EmailVerification migration', () => {
  const run = async (direction: 'up' | 'down'): Promise<string[]> => {
    const queries: string[] = [];
    await new EmailVerification1716500000000()[direction]({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);
    return queries;
  };

  it('creates the token table (hash only, address, expiry, single-use mark)', async () => {
    const [create] = await run('up');
    expect(create).toContain('CREATE TABLE `email_verification_tokens`');
    expect(create).toContain('`token_hash` varchar(64) NOT NULL');
    expect(create).toContain('UNIQUE INDEX `IDX_email_verification_tokens_hash`');
    expect(create).toContain('`email` varchar(255) NOT NULL');
    expect(create).toContain('`used_at` timestamp NULL');
    expect(create).toContain('ON DELETE CASCADE');
  });

  it('counts every account that exists when it runs (demo and staff included) as verified', async () => {
    const queries = await run('up');
    expect(queries).toContain('UPDATE `users` SET `email_verified` = 1 WHERE `email_verified` = 0');
  });

  it('drops the table on the way down', async () => {
    expect(await run('down')).toEqual(['DROP TABLE `email_verification_tokens`']);
  });
});
