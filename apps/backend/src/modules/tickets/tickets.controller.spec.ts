import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../../database/entities';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketScanResponseDto } from './dto/scan-ticket.dto';

// Building a NestJS TestingModule can be slow on CI — bump the timeout.
jest.setTimeout(30_000);

/**
 * Integration tests for the ticket scan endpoint.
 *
 * Strategy: real controller + real RolesGuard; JwtAuthGuard overridden to
 * inject a synthetic req.user so we can test gate vs. fan behaviour without
 * an actual JWT. TicketsService is replaced by a deterministic stub.
 *
 * Scenarios:
 *  PATCH /tickets/:id/scan
 *   1. Fan role  → 403
 *   2. Gate role, no token in body  → 400 (ValidationPipe)
 *   3. Gate role, valid token → 200 { success: true, result: 'ok' }
 *   4. Gate role, ticket already used → 200 { success: false, result: 'already_used' }
 *   5. Gate role, token for a different ticket → 200 { success: false, result: 'invalid' }
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICKET_ID = 'cccccccc-0000-4000-8000-000000000001';
const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakepayload.fakesig';

const GATE_USER = { id: 'gate-user-id', email: 'kapu@kte.hu', role: UserRole.GATE };
const FAN_USER = { id: 'fan-user-id', email: 'fan@kte.hu', role: UserRole.FAN };

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockTicketsService: Partial<TicketsService> = {
  scanTicket: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  findForUser: jest.fn().mockResolvedValue([]),
  getQrForOwner: jest.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TicketsController – scan endpoint', () => {
  let app: INestApplication;

  /**
   * Bootstraps the test app with a synthetic authenticated user.
   * JwtAuthGuard is replaced so no real JWT secret is needed.
   * RolesGuard is left real — this is what enforces the gate-role requirement.
   */
  async function buildApp(
    user: { id: string; email: string; role: UserRole } | null,
  ): Promise<void> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [{ provide: TicketsService, useValue: mockTicketsService }, RolesGuard, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!user) return false;
          const req = ctx.switchToHttp().getRequest<{ user: typeof user }>();
          req.user = user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: fan role → 403
  // -------------------------------------------------------------------------

  it('should return 403 when a fan tries to scan a ticket', async () => {
    await buildApp(FAN_USER);

    await request(app.getHttpServer())
      .patch(`/tickets/${TICKET_ID}/scan`)
      .send({ token: FAKE_TOKEN })
      .expect(403);

    expect(mockTicketsService.scanTicket).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: gate role, body missing token → 400
  // -------------------------------------------------------------------------

  it('should return 400 when a gate operator sends no token', async () => {
    await buildApp(GATE_USER);

    await request(app.getHttpServer()).patch(`/tickets/${TICKET_ID}/scan`).send({}).expect(400);

    expect(mockTicketsService.scanTicket).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: gate role, valid token → 200 ok
  // -------------------------------------------------------------------------

  it('should return 200 with ok result when scan succeeds', async () => {
    await buildApp(GATE_USER);

    const successResponse: TicketScanResponseDto = {
      success: true,
      result: 'ok',
      ticketId: TICKET_ID,
      scannedAt: new Date().toISOString(),
      match: {
        id: 'match-id',
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Ferencvárosi TC',
        venue: 'Széktói Stadion',
        kickoffAt: new Date().toISOString(),
      },
      seat: { id: 'seat-id', section: 'A', row: '1', number: 5, category: 'standard' },
    };
    (mockTicketsService.scanTicket as jest.Mock).mockResolvedValue(successResponse);

    const res = await request(app.getHttpServer())
      .patch(`/tickets/${TICKET_ID}/scan`)
      .send({ token: FAKE_TOKEN })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.result).toBe('ok');
    expect(res.body.ticketId).toBe(TICKET_ID);
    expect(res.body.match).toBeDefined();
    expect(res.body.seat).toBeDefined();
    expect(mockTicketsService.scanTicket).toHaveBeenCalledWith(TICKET_ID, {
      token: FAKE_TOKEN,
      scannedByUserId: GATE_USER.id,
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: gate role, ticket already used → 200 already_used (no entry)
  // -------------------------------------------------------------------------

  it('should return already_used and not grant entry when ticket was already scanned', async () => {
    await buildApp(GATE_USER);

    const alreadyUsedResponse: TicketScanResponseDto = {
      success: false,
      result: 'already_used',
      ticketId: TICKET_ID,
      scannedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    (mockTicketsService.scanTicket as jest.Mock).mockResolvedValue(alreadyUsedResponse);

    const res = await request(app.getHttpServer())
      .patch(`/tickets/${TICKET_ID}/scan`)
      .send({ token: FAKE_TOKEN })
      .expect(200);

    expect(res.body.success).toBe(false);
    expect(res.body.result).toBe('already_used');
    // Service called exactly once — no retry or state mutation beyond the check
    expect(mockTicketsService.scanTicket).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 5: gate role, token signed for a different ticket → 200 invalid
  // -------------------------------------------------------------------------

  it('should return invalid when the token belongs to a different ticket', async () => {
    await buildApp(GATE_USER);

    const invalidResponse: TicketScanResponseDto = {
      success: false,
      result: 'invalid',
      message: 'invalid_token',
    };
    (mockTicketsService.scanTicket as jest.Mock).mockResolvedValue(invalidResponse);

    const res = await request(app.getHttpServer())
      .patch(`/tickets/${TICKET_ID}/scan`)
      .send({ token: FAKE_TOKEN })
      .expect(200);

    expect(res.body.success).toBe(false);
    expect(res.body.result).toBe('invalid');
  });
});
