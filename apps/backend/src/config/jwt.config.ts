import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  accessSecret: string;
  accessExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
  bcryptRounds: number;
  /** How long an emailed password-reset link stays valid. */
  passwordResetTtlMinutes: number;
  /** How long the link confirming a new e-mail address stays valid. */
  emailChangeTtlMinutes: number;
  /** How long the link verifying a new account's address stays valid. */
  emailVerificationTtlHours: number;
}

export default registerAs(
  'jwt',
  (): JwtConfig => ({
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
    passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES ?? '60', 10),
    emailChangeTtlMinutes: parseInt(process.env.EMAIL_CHANGE_TTL_MINUTES ?? '60', 10),
    emailVerificationTtlHours: parseInt(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? '48', 10),
  }),
);
