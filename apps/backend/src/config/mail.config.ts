import { registerAs } from '@nestjs/config';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  retryDelayMs: number;
  baseUrl: string;
}

export default registerAs(
  'mail',
  (): MailConfig => ({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'no-reply@kte.hu',
    retryDelayMs: parseInt(
      process.env.EMAIL_RETRY_DELAY_MS ??
        (process.env.NODE_ENV === 'production' ? '60000' : '3000'),
      10,
    ),
    baseUrl: process.env.EMAIL_BASE_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:4200',
  }),
);
