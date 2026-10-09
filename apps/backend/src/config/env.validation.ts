import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  APP_NAME: Joi.string().default('KTE Jegyportal API'),
  APP_URL: Joi.string().uri().required(),
  FRONTEND_URL: Joi.string().uri().required(),
  CORS_ORIGINS: Joi.string().required(),
  HOME_TEAM_NAME: Joi.string().default('Kecskeméti TE'),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(3306),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_KEY_PREFIX: Joi.string().default('kte:'),

  // Seat lock
  SEAT_LOCK_TTL_SECONDS: Joi.number().integer().min(30).default(300),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Bcrypt
  BCRYPT_ROUNDS: Joi.number().integer().min(10).max(15).default(12),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_CURRENCY: Joi.string().lowercase().length(3).default('huf'),

  // Anthropic
  ANTHROPIC_API_KEY: Joi.string().required(),
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),
  ANTHROPIC_MAX_TOKENS: Joi.number().integer().min(64).default(1024),

  // OpenWeatherMap
  OPENWEATHER_API_KEY: Joi.string().allow('').optional(),
  OPENWEATHER_CITY: Joi.string().default('Kecskemet,HU'),
  OPENWEATHER_CACHE_TTL_SECONDS: Joi.number().integer().min(60).default(3600),

  // Mail (SMTP)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().allow('').required(),
  SMTP_FROM: Joi.string().email().required(),
  EMAIL_RETRY_DELAY_MS: Joi.number().integer().min(1000).default(60000),
  EMAIL_BASE_URL: Joi.string().uri().required(),

  // QR
  QR_SIGNING_SECRET: Joi.string().min(16).required(),
  QR_TICKET_ISSUER: Joi.string().default('kte-jegyportal'),
  QR_LOAN_ISSUER: Joi.string().default('kte-loan'),

  // Loyalty
  LOYALTY_REGISTRATION_POINTS: Joi.number().integer().min(0).default(100),
  LOYALTY_PROFILE_COMPLETION_POINTS: Joi.number().integer().min(0).default(50),
  LOYALTY_TICKET_POINTS_PER_TICKET: Joi.number().integer().min(0).default(50),
  LOYALTY_SEASON_PASS_POINTS: Joi.number().integer().min(0).default(500),
  LOYALTY_PASS_LOAN_POINTS: Joi.number().integer().min(0).default(25),
  LOYALTY_CARRYOVER_PERCENT: Joi.number().integer().min(0).max(100).default(50),

  // Cron
  LOAN_RELEASE_CRON: Joi.string().default('0 * * * *'),
  TICKET_EXPIRE_CRON: Joi.string().default('0 4 * * *'),
  CRON_TIMEZONE: Joi.string().default('Europe/Budapest'),
  LOAN_INVITATION_TTL_HOURS: Joi.number().integer().min(1).default(72),

  // Waitlist (Iteration 5)
  WAITLIST_CLAIM_TTL_SECONDS: Joi.number().integer().min(60).default(600),

  // Chatbot (Iteration 5)
  CHATBOT_RATE_LIMIT_AUTH: Joi.number().integer().min(1).default(100),
  CHATBOT_RATE_LIMIT_ANON: Joi.number().integer().min(1).default(20),
  CHATBOT_HISTORY_TTL_SECONDS: Joi.number().integer().min(60).default(86400),
  CHATBOT_HISTORY_MAX_MESSAGES: Joi.number().integer().min(2).default(20),
  CHATBOT_CONTEXT_CACHE_TTL_SECONDS: Joi.number().integer().min(30).default(300),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),
});
