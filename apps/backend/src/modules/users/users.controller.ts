import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  EmailChangeRequestedDto,
  ProfileDto,
  ProfileTicketsDto,
  RequestEmailChangeDto,
  UpdateProfileDto,
} from './dto';
import { EmailChangeService } from './email-change.service';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailChange: EmailChangeService,
  ) {}

  @Public()
  @Get('count')
  @ApiOperation({ summary: 'Regisztrált felhasználók száma (publikus statisztika)' })
  @ApiOkResponse({ description: 'Total number of registered users' })
  async count(): Promise<{ total: number }> {
    const total = await this.usersService.count();
    return { total };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bejelentkezett felhasználó profilja',
    description:
      'dateOfBirth ÉÉÉÉ-HH-NN formában; pendingEmail csak akkor szerepel, ha van megerősítésre váró címmódosítás.',
  })
  @ApiOkResponse({ type: ProfileDto })
  @ApiUnauthorizedResponse({ description: 'Bejelentkezés szükséges.' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileDto> {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Profil adatok frissítése',
    description:
      'Csak firstName, lastName, phoneNumber, dateOfBirth. Az e-mail-cím itt nem módosítható (lásd POST /users/me/email-change). phoneNumber: "" törli.',
  })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ description: 'Mezőszintű validációs hiba (message: string[]).' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Post('me/email-change')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'emailchange:ip', limit: 20, windowSeconds: 3600 })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'E-mail-cím módosításának kérése (megerősítés után lép életbe)',
    description:
      'A jelenlegi jelszó szükséges. A fiók címe NEM változik, amíg az új címre küldött link meg nem nyílik (POST /auth/confirm-email-change). ' +
      'A jelenlegi cím értesítést kap (maszkolt új címmel, link nélkül). Az újabb kérés a korábbi linket érvényteleníti. ' +
      'Fiókonként 5 jelszópróba / óra (emailchange:user), IP-nként 20 kérés / óra.',
  })
  @ApiAcceptedResponse({ type: EmailChangeRequestedDto })
  @ApiBadRequestResponse({
    description: 'current_password_incorrect | email_unchanged | mezőszintű validációs hiba',
  })
  @ApiConflictResponse({ description: 'email_taken: a cím már egy másik fiókhoz tartozik.' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  @ApiUnauthorizedResponse({ description: 'Bejelentkezés szükséges.' })
  async requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEmailChangeDto,
    @Req() req: Request,
  ): Promise<EmailChangeRequestedDto> {
    // req.ip honours `trust proxy`; the raw X-Forwarded-For header is caller-controlled.
    return this.emailChange.requestChange(user.id, dto.newEmail, dto.currentPassword, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me/tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'A felhasználó jegyei (aktív + korábbi)',
    description: 'Lapozható lista. Minden jegyhez visszaadjuk a meccs és szék részleteit.',
  })
  @ApiOkResponse({ type: ProfileTicketsDto })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  async myTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<ProfileTicketsDto> {
    return this.usersService.getTickets(user.id, limit, offset);
  }
}
