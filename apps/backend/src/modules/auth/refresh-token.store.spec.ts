import { RefreshTokenStore } from './refresh-token.store';

/** The Redis client is configured with a key prefix; revokeAll has to cope with it. */
describe('RefreshTokenStore.revokeAll', () => {
  function setup(keyPrefix: string | undefined, stored: string[]) {
    const deleted: string[] = [];
    const pipeline = {
      del: (k: string) => {
        deleted.push(k);
        return pipeline;
      },
      exec: jest.fn().mockResolvedValue([]),
    };
    let matched = '';
    const redis = {
      options: { keyPrefix },
      pipeline: () => pipeline,
      // SCAN does not add the prefix to MATCH, and returns the keys WITH the prefix.
      scanStream: ({ match }: { match: string }) => {
        matched = match;
        const stem = match.slice(0, -1); // the patterns used here end in a single '*'
        return (async function* () {
          yield stored.filter((k) => k.startsWith(stem));
        })();
      },
    };
    return { store: new RefreshTokenStore(redis as never), deleted, matched: () => matched };
  }

  it("deletes the account's tokens, and only those, when the client has a key prefix", async () => {
    const { store, deleted, matched } = setup('kte:', [
      'kte:refresh:u1:a',
      'kte:refresh:u1:b',
      'kte:refresh:u2:c',
    ]);
    await store.revokeAll('u1');
    expect(matched()).toBe('kte:refresh:u1:*');
    // DEL gets the key without the prefix, because the client adds it back
    expect(deleted).toEqual(['refresh:u1:a', 'refresh:u1:b']);
  });

  it('still works with no prefix', async () => {
    const { store, deleted } = setup(undefined, ['refresh:u1:a', 'refresh:u2:b']);
    await store.revokeAll('u1');
    expect(deleted).toEqual(['refresh:u1:a']);
  });
});
