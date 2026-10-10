import {
  ConflictException,
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
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SeatLockService } from '../../redis/seat-lock.service';
import { SeatsService } from './seats.service';
import { LockSeatResponseDto, MatchSeatsResponseDto, SeatAvailability } from './dto';

@ApiTags('Seats')
@Controller('matches/:matchId/seats')
export class MatchSeatsController {
  constructor(
    private readonly seatsService: SeatsService,
    private readonly seatLockService: SeatLockService,
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

  @Post(':seatId/lock')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Szék zárolása vásárláshoz',
    description:
      'Atomi `SET NX EX` művelettel zárolja a széket Redis-ben (alapértelmezett TTL 300 mp). Sikeres zárolás esetén egy ownerToken-t kap a hívó. Bejelentkezett és vendég felhasználó is használhatja: ha JWT érkezik, a `userId` a lock metaadatába kerül.',
  })
  @ApiOkResponse({ type: LockSeatResponseDto })
  @ApiConflictResponse({ description: 'A szék már zárolva van.' })
  async lockSeat(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<LockSeatResponseDto> {
    const availability = await this.seatsService.resolveAvailabilityForSeats(matchId, [seatId]);
    const status = availability.get(seatId);

    if (status === undefined) {
      throw new NotFoundException(`A szék (${seatId}) nem található.`);
    }
    if (status === SeatAvailability.DISABLED) {
      throw new ConflictException('Ez a hely nem foglalható.');
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
      userId: user?.id,
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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Szék zárolásának meghosszabbítása',
    description:
      'A meglévő TTL-t újraindítja a megadott értékre, ha az ownerToken egyezik. Fizetési hiba utáni retry forgatókönyvhöz használjuk.',
  })
  @ApiOkResponse({ type: LockSeatResponseDto })
  async extendLock(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @Query('ownerToken') ownerToken: string,
    @Query('ttlSeconds') ttlSeconds?: string,
  ): Promise<LockSeatResponseDto> {
    if (!ownerToken) {
      throw new NotFoundException('ownerToken query paraméter kötelező.');
    }
    const ttl = ttlSeconds ? Math.max(parseInt(ttlSeconds, 10) || 0, 60) : undefined;
    const ok = await this.seatLockService.extend(matchId, seatId, ownerToken, ttl);
    if (!ok) {
      throw new ConflictException('A zárolás már lejárt vagy másé.');
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
