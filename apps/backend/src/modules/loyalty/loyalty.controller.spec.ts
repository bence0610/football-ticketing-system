import { INestApplication } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserRole } from '../../database/entities';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

jest.setTimeout(30_000);

/**
 * GET /loyalty/transactions/count used to be open to anonymous callers.
 * Real RolesGuard; JwtAuthGuard replaced by a stub that injects `currentUser`.
 */
describe('LoyaltyController – transactions/count access', () => {
  let app: INestApplication;
  let currentUser: { id: string; email: string; role: UserRole } | null = null;
  const loyaltyService = { count: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LoyaltyController],
      providers: [{ provide: LoyaltyService, useValue: loyaltyService }, RolesGuard, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!currentUser) return false;
          ctx.switchToHttp().getRequest<{ user: typeof currentUser }>().user = currentUser;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    loyaltyService.count.mockReset().mockResolvedValue(7);
    currentUser = null;
  });

  it('rejects an anonymous caller', async () => {
    await request(app.getHttpServer()).get('/loyalty/transactions/count').expect(403);
    expect(loyaltyService.count).not.toHaveBeenCalled();
  });

  it.each([UserRole.FAN, UserRole.GATE])('rejects the %s role', async (role) => {
    currentUser = { id: 'u', email: 'u@kte.hu', role };
    await request(app.getHttpServer()).get('/loyalty/transactions/count').expect(403);
    expect(loyaltyService.count).not.toHaveBeenCalled();
  });

  it('returns the total to an admin', async () => {
    currentUser = { id: 'a', email: 'a@kte.hu', role: UserRole.ADMIN };
    const res = await request(app.getHttpServer()).get('/loyalty/transactions/count').expect(200);
    expect(res.body).toEqual({ total: 7 });
  });
});
