import { LoyaltyTransactionSource, User } from '../../database/entities';
import { UsersService } from './users.service';

function setup(initial: Partial<User> = {}, pendingEmail?: string) {
  // The "database": what save() persisted, column by column. save() skips
  // undefined properties, exactly like TypeORM does.
  const stored: Record<string, unknown> = {
    id: 'u1',
    email: 'fan@kte.hu',
    firstName: 'Béla',
    lastName: 'Kovács',
    passwordHash: 'hash',
    role: 'fan',
    loyaltyTier: 'bronze',
    loyaltyPoints: 100,
    emailVerified: false,
    twoFactorEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...initial,
  };
  const userRepository = {
    findOne: jest.fn(async () => ({ ...stored }) as unknown as User),
    save: jest.fn(async (u: User) => {
      for (const [k, v] of Object.entries(u)) {
        if (v !== undefined) stored[k] = v;
      }
      return u;
    }),
  };
  const loyaltyService = {
    award: jest.fn(async () => undefined),
    getConfig: () => ({ profileCompletionPoints: 50 }),
  };
  const emailChange = { pendingEmailFor: jest.fn(async () => pendingEmail) };
  const service = new UsersService(
    userRepository as never,
    {} as never,
    loyaltyService as never,
    emailChange as never,
  );
  return { service, stored, loyaltyService, emailChange };
}

describe('UsersService profile', () => {
  it('returns dateOfBirth as YYYY-MM-DD, whether or not the profile is complete', async () => {
    const { service } = setup({ dateOfBirth: new Date('1990-01-15') });
    const profile = await service.getProfile('u1');
    expect(profile.dateOfBirth).toBe('1990-01-15');
  });

  it('leaves dateOfBirth and pendingEmail out when there are none', async () => {
    const { service } = setup();
    const profile = await service.getProfile('u1');
    expect(profile.dateOfBirth).toBeUndefined();
    expect('pendingEmail' in profile).toBe(false);
  });

  it('reports a pending e-mail change; email stays the current address', async () => {
    const { service } = setup({}, 'uj@pelda.hu');
    const profile = await service.getProfile('u1');
    expect(profile.email).toBe('fan@kte.hu');
    expect(profile.pendingEmail).toBe('uj@pelda.hu');
  });

  it('clearing the phone number ("") persists NULL', async () => {
    const { service, stored } = setup({ phoneNumber: '+36301234567' });
    const profile = await service.updateProfile('u1', { phoneNumber: '' });
    expect(stored.phoneNumber).toBeNull();
    expect(profile.phoneNumber).toBeUndefined();
  });

  it('clearing the date of birth (null) persists NULL, and leaving it out changes nothing', async () => {
    const { service, stored } = setup({ dateOfBirth: new Date('1990-01-15') });
    await service.updateProfile('u1', { firstName: 'Béla' });
    expect(stored.dateOfBirth).toEqual(new Date('1990-01-15'));
    const profile = await service.updateProfile('u1', { dateOfBirth: null });
    expect(stored.dateOfBirth).toBeNull();
    expect(profile.dateOfBirth).toBeUndefined();
  });

  it('trims a phone number', async () => {
    const { service, stored } = setup();
    await service.updateProfile('u1', { phoneNumber: '  +36 30 123 4567 ' });
    expect(stored.phoneNumber).toBe('+36 30 123 4567');
  });

  it('awards the completion bonus once, on first completion only', async () => {
    const { service, loyaltyService } = setup();
    await service.updateProfile('u1', { phoneNumber: '+36301234567' });
    expect(loyaltyService.award).not.toHaveBeenCalled();
    await service.updateProfile('u1', { dateOfBirth: new Date('1990-01-15') });
    expect(loyaltyService.award).toHaveBeenCalledTimes(1);
    expect(loyaltyService.award).toHaveBeenCalledWith(
      expect.objectContaining({
        source: LoyaltyTransactionSource.PROFILE_COMPLETION,
        referenceId: 'profile_completion:u1',
      }),
    );
    // Clearing and re-filling does not award again.
    await service.updateProfile('u1', { phoneNumber: '' });
    await service.updateProfile('u1', { phoneNumber: '+36301234567' });
    expect(loyaltyService.award).toHaveBeenCalledTimes(1);
  });
});
