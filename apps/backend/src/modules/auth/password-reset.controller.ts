import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import {
  PasswordResetDoneDto,
  PasswordResetRequestedDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto';
import { PasswordResetService } from './password-reset.service';

@ApiTags('Auth')
@Public()
@UseGuards(RateLimitGuard)
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'pwreset:request', limit: 10, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Jelszó-visszaállító link kérése e-mailben',
    description:
      'Mindig ugyanazt válaszolja, akár létezik a fiók, akár nem. Címenként és IP-címenként korlátozott.',
  })
  @ApiOkResponse({ type: PasswordResetRequestedDto })
  @ApiTooManyRequestsResponse({ description: 'Túl sok kérés erről a címről.' })
  async request(@Body() dto: RequestPasswordResetDto): Promise<PasswordResetRequestedDto> {
    await this.passwordReset.requestReset(dto.email);
    return { message: this.passwordReset.requestedMessage() };
  }

  @Get(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ scope: 'pwreset:confirm', limit: 60, windowSeconds: 3600 })
  @ApiOperation({ summary: 'A visszaállító link még használható-e (nem használja fel)' })
  @ApiNoContentResponse({ description: 'A link használható.' })
  @ApiBadRequestResponse({
    description: 'reset_token_invalid | reset_token_expired | reset_token_used',
  })
  async check(@Param('token') token: string): Promise<void> {
    await this.passwordReset.checkToken(token);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'pwreset:confirm', limit: 60, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Új jelszó beállítása a levélben kapott linkkel',
    description:
      'A link egyszer használható. Siker után a fiók összes refresh tokenje érvénytelen.',
  })
  @ApiOkResponse({ type: PasswordResetDoneDto })
  @ApiBadRequestResponse({
    description: 'reset_token_invalid | reset_token_expired | reset_token_used | jelszóhiba',
  })
  async confirm(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<PasswordResetDoneDto> {
    // req.ip honours `trust proxy`; the raw X-Forwarded-For header is caller-controlled.
    await this.passwordReset.resetPassword(dto.token, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'A jelszavad megváltozott. Jelentkezz be az új jelszóval.' };
  }
}
