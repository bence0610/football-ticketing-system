import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SeatLockService } from '../../redis/seat-lock.service';
import { BestSeatsService } from './best-seats.service';
import { MatchSeatsController } from './match-seats.controller';
import { SeatsService } from './seats.service';

const MATCH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('POST /matches/:matchId/seats/best (validation and wiring)', () => {
  let app: INestApplication;
  const findAndLock = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MatchSeatsController],
      providers: [
        { provide: SeatsService, useValue: {} },
        { provide: SeatLockService, useValue: {} },
        { provide: BestSeatsService, useValue: { findAndLock } },
      ],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => findAndLock.mockReset().mockResolvedValue({ kind: 'together' }));

  const post = (body: unknown) => request(app.getHttpServer()).post(`/matches/${MATCH_ID}/seats/best`).send(body as object);

  it('passes the party size, sector and the split choice through', async () => {
    await post({ section: 'C/2', count: 4, allowSplit: true }).expect(201);
    expect(findAndLock).toHaveBeenCalledWith({
      matchId: MATCH_ID,
      section: 'C/2',
      count: 4,
      allowSplit: true,
      userId: undefined,
    });
  });

  it('does not allow a split unless asked', async () => {
    await post({ section: 'C/2', count: 2 }).expect(201);
    expect(findAndLock).toHaveBeenCalledWith(expect.objectContaining({ allowSplit: false }));
  });

  it.each([
    [{ section: 'C/2', count: 0 }],
    [{ section: 'C/2', count: 7 }],
    [{ section: 'C/2', count: 2.5 }],
    [{ section: 'C/2', count: '3' }],
    [{ section: '', count: 2 }],
    [{ count: 2 }],
    [{ section: 'C/2' }],
  ])('rejects %j with 400 before anything is locked', async (body) => {
    await post(body).expect(400);
    expect(findAndLock).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID match id', async () => {
    await request(app.getHttpServer()).post('/matches/nope/seats/best').send({ section: 'C/2', count: 2 }).expect(400);
  });
});
