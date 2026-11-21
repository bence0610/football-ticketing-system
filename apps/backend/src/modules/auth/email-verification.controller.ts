import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ConfirmEmailVerificationDto,
  EmailVerifiedDto,
  VerificationResentDto,
} from './dto/email-verification.dto';
import { EmailVerificationService } from './email-verification.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('Auth')
@Controller('auth/verify-email')
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Public()
  @Post('confirm')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'emailverify:confirm', limit: 60, windowSeconds: 3600 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A regisztrációkor megadott e-mail-cím megerősítése a levélben kapott linkkel',
    description:
      'Publikus: a linket a postafiókból nyitják meg, akár másik böngészőben; az egyszer használható titkos token a hitelesítő. ' +
      'Siker után a fiók címe megerősített (email_verified = true). IP-nként 60 kérés / óra.',
  })
  @ApiOkResponse({ type: EmailVerifiedDto })
  @ApiBadRequestResponse({
    description:
      'verification_token_invalid | verification_token_expired | verification_token_used',
  })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  async confirm(@Body() dto: ConfirmEmailVerificationDto): Promise<EmailVerifiedDto> {
    const { email } = await this.verification.confirm(dto.token);
    return { message: 'Az e-mail-címed megerősítve.', email };
  }

  @Post('resend')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ scope: 'emailverify:resend', limit: 10, windowSeconds: 3600, by: 'user' })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Új megerősítő levél kérése a még meg nem erősített fiókhoz',
    description:
      'Az újabb link érvényteleníti a korábbiakat. Fiókonként legfeljebb 4 levél óránként; megerősített fióknak nem megy levél.',
  })
  @ApiOkResponse({ type: VerificationResentDto })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  async resend(@CurrentUser() user: AuthenticatedUser): Promise<VerificationResentDto> {
    const { alreadyVerified } = await this.verification.resend(user.id);
    return {
      alreadyVerified,
      message: alreadyVerified
        ? 'Az e-mail-címed már meg van erősítve.'
        : 'Új megerősítő levelet küldtünk.',
    };
  }
}
