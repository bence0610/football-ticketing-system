import {
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { MAX_SEATS_PER_ORDER } from '../payments/dto/create-payment-intent.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SeatLockService } from '../../redis/seat-lock.service';
import { SeatsService } from './seats.service';
import { BestSeatsService } from './best-seats.service';
import {
  BestSeatsRequestDto,
  BestSeatsResponseDto,
  LockSeatResponseDto,
  MatchSeatsResponseDto,
  SeatAvailability,
} from './dto';

@ApiTags('Seats')
@Controller('matches/:matchId/seats')
export class MatchSeatsController {
  constructor(
    private readonly seatsService: SeatsService,
    private readonly seatLockService: SeatLockService,
    private readonly bestSeatsService: BestSeatsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Egy meccshez tartozó székek valós idejű állapota',
    description:
      'Visszaadja az összes szék státuszát (available / locked / sold / disabled) és a szektoronkénti foglaltsági összesítőt.',
  })
  @ApiOkResponse({ type: MatchSeatsResponseDto })
  @ApiNotFoundResponse({ description: 'Match not found' })
  findSeats(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
  ): Promise<MatchSeatsResponseDto> {
    return this.seatsService.findSeatsForMatch(matchId);
  }

  @Post('best')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'seats:best', limit: 20, windowSeconds: 60, by: 'user' })
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ description: 'Helyfoglaláshoz bejelentkezés szükséges.' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'A legjobb egymás melletti szabad székek megkeresése és zárolása',
    description:
      'Egyetlen szerveroldali művelet: a rangsorolt elhelyezések közül a Redis (Lua szkript) az első teljesen szabadot zárolja, egy lépésben, ezért két egyidejű kérés nem kaphatja ugyanazt a sort. Soha nem ad vendégszektorbeli széket. Ha nincs elég hosszú sor, 409 `no_adjacent_run` (vagy `not_enough_seats`) a válasz a leghosszabb sorral és a felajánlható két rövidebb sorral; `allowSplit: true` esetén ezt zárolja is.',
  })
  @ApiOkResponse({ type: BestSeatsResponseDto })
  @ApiConflictResponse({
    description: '`no_adjacent_run`, `not_enough_seats`, `contended` vagy `match_started`.',
  })
  findBestSeats(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body() body: BestSeatsRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BestSeatsResponseDto> {
    return this.bestSeatsService.findAndLock({
      matchId,
      section: body.section,
      count: body.count,
      allowSplit: body.allowSplit ?? false,
      userId: user.id,
    });
  }

  @Post(':seatId/lock')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'seats:lock', limit: 30, windowSeconds: 60, by: 'user' })
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ description: 'Helyfoglaláshoz bejelentkezés szükséges.' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Szék zárolása vásárláshoz',
    description:
      'Bejelentkezés szükséges. Atomi művelettel zárolja a széket Redis-ben (alapértelmezett TTL 300 mp), és egy ownerToken-t ad a hívónak. Egy felhasználó egy mérkőzésre egyszerre legfeljebb 6 helyet tarthat lefoglalva (409 `seat_limit_reached`). Felhasználónként 30 hívás / perc.',
  })
  @ApiOkResponse({ type: LockSeatResponseDto })
  @ApiConflictResponse({
    description: 'A szék már zárolva van, vagy a mérkőzés már elkezdődött (`match_started`).',
  })
  async lockSeat(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LockSeatResponseDto> {
    // A match that has kicked off cannot be bought, whatever the client showed.
    await this.seatsService.assertMatchOpenForSale(matchId);

    const availability = await this.seatsService.resolveAvailabilityForSeats(matchId, [seatId]);
    const status = availability.get(seatId);

    if (status === undefined) {
      throw new NotFoundException(`A szék (${seatId}) nem található.`);
    }
    if (status === SeatAvailability.DISABLED) {
      throw new ConflictException('Ez a hely nem foglalható.');
    }
    if (status === SeatAvailability.AWAY) {
      throw new ForbiddenException('A vendégszektor helyei a portálon nem vásárolhatók meg.');
    }
    if (status === SeatAvailability.SOLD) {
      throw new ConflictException('Ez a hely már elkelt.');
    }
    if (status === SeatAvailability.SEASON_PASS) {
      throw new ConflictException('Ez a hely bérletes hely.');
    }

    const lock = await this.seatLockService.acquire({
      matchId,
      seatId,
      userId: user.id,
      maxHeldSeats: MAX_SEATS_PER_ORDER,
    });
    if (!lock) {
      throw new ConflictException(
        `Seat ${seatId} for match ${matchId} is already locked. Please pick a different seat.`,
      );
    }
    const expiresAt = new Date(Date.now() + lock.ttlSeconds * 1000).toISOString();
    return {
      matchId: lock.matchId,
      seatId: lock.seatId,
      ownerToken: lock.ownerToken,
      ttlSeconds: lock.ttlSeconds,
      expiresAt,
    };
  }

  @Post(':seatId/lock/extend')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'seats:extend', limit: 20, windowSeconds: 60, by: 'user' })
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ description: 'Bejelentkezés szükséges.' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Szék zárolásának meghosszabbítása',
    description:
      'Bejelentkezés szükséges. A meglévő TTL-t újraindítja a beállított foglalási időre (SEAT_LOCK_TTL_SECONDS), ha az ownerToken egyezik, de a teljes tartás az első zárolástól számítva sem lehet hosszabb, mint SEAT_LOCK_MAX_HOLD_SECONDS (alapértelmezés 20 perc): ha már elérte, 409 `hold_limit_reached`. A hossz szerveroldali beállítás, a kliens nem adhat meg sajátot. Felhasználónként 20 hívás / perc.',
  })
  @ApiOkResponse({ type: LockSeatResponseDto })
  async extendLock(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @Query('ownerToken') ownerToken: string,
  ): Promise<LockSeatResponseDto> {
    if (!ownerToken) {
      throw new NotFoundException('ownerToken query paraméter kötelező.');
    }
    // The hold length is the configured one (SeatLockService default); never client-chosen.
    const outcome = await this.seatLockService.extendWithinLimit(matchId, seatId, ownerToken);
    if (outcome === 'lost') {
      throw new ConflictException('A zárolás már lejárt vagy másé.');
    }
    if (outcome === 'at_limit') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'hold_limit_reached',
        message:
          'A foglalás elérte a legnagyobb tartási időt, tovább nem hosszabbítható. Fizess most, vagy válassz újra helyet.',
      });
    }
    const remaining = await this.seatLockService.getRemainingTtl(matchId, seatId);
    const expiresAt = new Date(Date.now() + Math.max(remaining, 0) * 1000).toISOString();
    return {
      matchId,
      seatId,
      ownerToken,
      ttlSeconds: Math.max(remaining, 0),
      expiresAt,
    };
  }

  @Delete(':seatId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Szék zárolásának feloldása',
    description:
      'Lua-alapú feltételes DEL — csak akkor töröl, ha az ownerToken egyezik. Ha a token nem egyezik, NoContent választ ad (idempotens).',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Lock not held / token mismatch.' })
  async unlockSeat(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @Query('ownerToken') ownerToken: string,
  ): Promise<void> {
    if (!ownerToken) {
      throw new NotFoundException('ownerToken query parameter is required.');
    }
    await this.seatLockService.release(matchId, seatId, ownerToken);
  }
}
