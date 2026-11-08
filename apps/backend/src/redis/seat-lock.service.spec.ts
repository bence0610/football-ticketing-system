import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SeatLockService } from './seat-lock.service';
import { REDIS_CLIENT } from './redis.constants';

interface MockStoreEntry {
  value: string;
  ttl: number;
}

/**
 * In-memory Redis double that implements just enough of the ioredis surface
 * to validate SeatLockService semantics (SET NX EX, EXISTS, TTL, EVAL with
 * the GET-then-DEL/EXPIRE Lua scripts we ship).
 */
class InMemoryRedisMock {
  private store = new Map<string, MockStoreEntry>();

  async set(
    key: string,
    value: string,
    _exFlag: 'EX',
    ttl: number,
    nxFlag?: 'NX',
  ): Promise<'OK' | null> {
    if (nxFlag === 'NX' && this.store.has(key)) {
      return null;
    }
    this.store.set(key, { value, ttl });
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    return entry.ttl;
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    expectedValue: string,
    newTtl?: string,
  ): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.value !== expectedValue) return 0;

    if (newTtl !== undefined) {
      // EXTEND_LOCK_LUA path — update ttl
      this.store.set(key, { value: entry.value, ttl: parseInt(newTtl, 10) });
      return 1;
    }
    // RELEASE_LOCK_LUA path — delete
    this.store.delete(key);
    return 1;
  }

  reset(): void {
    this.store.clear();
  }

  forceSet(key: string, value: string, ttl = 300): void {
    this.store.set(key, { value, ttl });
  }
}

describe('SeatLockService', () => {
  let service: SeatLockService;
  let redisMock: InMemoryRedisMock;

  beforeEach(async () => {
    redisMock = new InMemoryRedisMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SeatLockService,
        { provide: REDIS_CLIENT, useValue: redisMock },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({
              host: 'localhost',
              port: 6379,
              db: 0,
              keyPrefix: 'kte:',
              seatLockTtlSeconds: 300,
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(SeatLockService);
  });

  describe('acquire', () => {
    it('locks a free seat with default 300s TTL', async () => {
      const lock = await service.acquire({ matchId: 'm1', seatId: 's1' });

      expect(lock).not.toBeNull();
      expect(lock?.matchId).toBe('m1');
      expect(lock?.seatId).toBe('s1');
      expect(lock?.ttlSeconds).toBe(300);
      expect(lock?.ownerToken).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns null when the seat is already locked', async () => {
      const first = await service.acquire({ matchId: 'm1', seatId: 's1' });
      expect(first).not.toBeNull();

      const second = await service.acquire({ matchId: 'm1', seatId: 's1' });
      expect(second).toBeNull();
    });

    it('reports the configured TTL and actually applies it in Redis', async () => {
      const configured = 420;
      const moduleRef = await Test.createTestingModule({
        providers: [
          SeatLockService,
          { provide: REDIS_CLIENT, useValue: redisMock },
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn().mockReturnValue({ seatLockTtlSeconds: configured }),
            },
          },
        ],
      }).compile();
      const configuredService = moduleRef.get(SeatLockService);

      const lock = await configuredService.acquire({ matchId: 'm1', seatId: 's9' });

      // what the lock endpoint reports must equal what Redis enforces
      expect(lock?.ttlSeconds).toBe(configured);
      expect(await configuredService.getRemainingTtl('m1', 's9')).toBe(configured);
    });

    it('honours a custom TTL', async () => {
      const lock = await service.acquire({ matchId: 'm1', seatId: 's2', ttlSeconds: 60 });
      expect(lock?.ttlSeconds).toBe(60);
      const ttl = await service.getRemainingTtl('m1', 's2');
      expect(ttl).toBe(60);
    });

    it('uses the supplied owner token when provided', async () => {
      const token = '11111111-1111-1111-1111-111111111111';
      const lock = await service.acquire({ matchId: 'm1', seatId: 's3', ownerToken: token });
      expect(lock?.ownerToken).toBe(token);
    });
  });

  describe('release', () => {
    it('releases a lock when the owner token matches', async () => {
      const lock = await service.acquire({ matchId: 'm1', seatId: 's1' });
      const released = await service.release('m1', 's1', lock!.ownerToken);
      expect(released).toBe(true);
      expect(await service.isLocked('m1', 's1')).toBe(false);
    });

    it('does not release a lock when the owner token differs', async () => {
      await service.acquire({ matchId: 'm1', seatId: 's1' });
      const released = await service.release('m1', 's1', 'wrong-token');
      expect(released).toBe(false);
      expect(await service.isLocked('m1', 's1')).toBe(true);
    });

    it('returns false when no lock exists', async () => {
      const released = await service.release('m1', 'ghost', 'any');
      expect(released).toBe(false);
    });
  });

  describe('extend', () => {
    it('extends the TTL when the owner token matches', async () => {
      const lock = await service.acquire({ matchId: 'm1', seatId: 's1', ttlSeconds: 60 });
      const extended = await service.extend('m1', 's1', lock!.ownerToken, 600);
      expect(extended).toBe(true);
      expect(await service.getRemainingTtl('m1', 's1')).toBe(600);
    });

    it('restarts the lock at the configured TTL when no TTL is given', async () => {
      const lock = await service.acquire({ matchId: 'm1', seatId: 's7', ttlSeconds: 30 });
      expect(await service.getRemainingTtl('m1', 's7')).toBe(30);

      const extended = await service.extend('m1', 's7', lock!.ownerToken);

      expect(extended).toBe(true);
      // the configured default (300 in this spec's config), not a literal in the caller
      expect(await service.getRemainingTtl('m1', 's7')).toBe(300);
    });

    it('refuses to extend when the owner token differs', async () => {
      await service.acquire({ matchId: 'm1', seatId: 's1', ttlSeconds: 60 });
      const extended = await service.extend('m1', 's1', 'wrong', 600);
      expect(extended).toBe(false);
      expect(await service.getRemainingTtl('m1', 's1')).toBe(60);
    });
  });

  describe('isLocked / getRemainingTtl', () => {
    it('reports unlocked seats correctly', async () => {
      expect(await service.isLocked('m1', 's1')).toBe(false);
      expect(await service.getRemainingTtl('m1', 's1')).toBe(-2);
    });

    it('reports locked seats correctly', async () => {
      await service.acquire({ matchId: 'm1', seatId: 's1' });
      expect(await service.isLocked('m1', 's1')).toBe(true);
      expect(await service.getRemainingTtl('m1', 's1')).toBe(300);
    });
  });
});
