import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import jwtConfig from './jwt.config';
import stripeConfig from './stripe.config';
import anthropicConfig from './anthropic.config';
import mailConfig from './mail.config';
import weatherConfig from './weather.config';
import qrConfig from './qr.config';
import loyaltyConfig from './loyalty.config';
import cronConfig from './cron.config';
import waitlistConfig from './waitlist.config';
import chatbotConfig from './chatbot.config';
import gateConfig from './gate.config';

export const configurations = [
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  stripeConfig,
  anthropicConfig,
  mailConfig,
  weatherConfig,
  qrConfig,
  loyaltyConfig,
  cronConfig,
  waitlistConfig,
  chatbotConfig,
  gateConfig,
];

export * from './app.config';
export * from './database.config';
export * from './redis.config';
export * from './jwt.config';
export * from './stripe.config';
export * from './anthropic.config';
export * from './mail.config';
export * from './weather.config';
export * from './qr.config';
export * from './loyalty.config';
export * from './cron.config';
export * from './waitlist.config';
export * from './chatbot.config';
export * from './gate.config';
export * from './env.validation';
