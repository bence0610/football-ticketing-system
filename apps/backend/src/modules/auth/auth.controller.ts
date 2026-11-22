import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../../config';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { EmailChangeService } from '../users/email-change.service';
import { AuthService } from './auth.service';
import { GateAllowed } from './decorators/gate-allowed.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  AuthResponseDto,
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  EmailChangeConfirmedDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './dto';
import { PasswordChangeService } from './password-change.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './strategies/jwt.strategy';

const REFRESH_COOKIE_NAME = 'kte_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly passwordChange: PasswordChangeService,
    private readonly emailChange: EmailChangeService,
  ) {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    this.cookieSecure = appConfig.nodeEnv === 'production';
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Új felhasználó regisztrációja' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bejelentkezés e-mail + jelszó alapján' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Hibás e-mail vagy jelszó.' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Új access token kérése',
    description:
      'Olvassa a HttpOnly cookie-t (kte_refresh_token); ha az nincs, a body-ban érkezett refreshToken-t használja. Sikerre rotálja a refresh-t és új cookie-t állít.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Érvénytelen vagy lejárt refresh token.' })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const refreshToken = this.extractRefreshToken(req, dto);
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Post('logout')
  @GateAllowed()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Kijelentkezés — a refresh tokent visszavonja.' })
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @CurrentUser() _user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = this.extractRefreshToken(req, dto);
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(res);
  }

  @Post('change-password')
  @GateAllowed()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'pwchange:ip', limit: 30, windowSeconds: 3600 })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Jelszócsere bejelentkezve',
    description:
      'A jelenlegi jelszó szükséges; az új jelszóra ugyanaz a szabály vonatkozik, mint a regisztrációnál. ' +
      'Siker után a fiók összes refresh tokenje érvénytelen (mint jelszó-visszaállításkor), a hívó viszont új token-párt kap ' +
      '(a válasz a bejelentkezésével azonos, a refresh süti is újra beállítva), így ez a munkamenet bejelentkezve marad. ' +
      'A többi eszközön már kiadott access token a lejáratáig (alapértelmezés 15 perc) még érvényes. ' +
      'A fiók címe értesítést kap (password-changed). Fiókonként 10 próbálkozás / óra (pwchange:user), IP-nként 30 / óra.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({
    description:
      'current_password_incorrect (soha nem 401) | password_unchanged | mezőszintű validációs hiba',
  })
  @ApiConflictResponse({ description: 'password_changed_concurrently' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  @ApiUnauthorizedResponse({
    description: 'Bejelentkezés szükséges (hiányzó/lejárt access token).',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    // req.ip honours `trust proxy`; the raw X-Forwarded-For header is caller-controlled.
    const result = await this.passwordChange.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Public()
  @Post('confirm-email-change')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'emailchange:confirm', limit: 60, windowSeconds: 3600 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Új e-mail-cím megerősítése a levélben kapott linkkel',
    description:
      'Publikus: a linket az új postafiókból nyitják meg, akár másik böngészőben; az egyszer használható titkos token a hitelesítő. ' +
      'Siker után a fiók címe az új cím (email_verified = true), a még élő bérletkölcsön-meghívók követik a címet, ' +
      'a régi címre küldött jelszó-visszaállító linkek érvénytelenek, a régi cím értesítést kap. ' +
      'A munkamenetek NEM szűnnek meg (a kéréshez a jelszó kellett). IP-nként 60 kérés / óra.',
  })
  @ApiOkResponse({ type: EmailChangeConfirmedDto })
  @ApiBadRequestResponse({
    description:
      'email_change_token_invalid | email_change_token_used | email_change_token_expired | email_change_token_password_changed',
  })
  @ApiConflictResponse({ description: 'email_taken: a cím közben egy másik fiókhoz került.' })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  async confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @Req() req: Request,
  ): Promise<EmailChangeConfirmedDto> {
    return this.emailChange.confirmChange(dto.token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private extractRefreshToken(req: Request, dto: RefreshDto): string {
    const cookieHeader = (req as Request & { cookies?: Record<string, string> }).cookies;
    const fromCookie = cookieHeader?.[REFRESH_COOKIE_NAME];
    return (fromCookie ?? dto.refreshToken ?? '').trim();
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, this.cookieOptions());
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSecure ? 'strict' : 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
}
