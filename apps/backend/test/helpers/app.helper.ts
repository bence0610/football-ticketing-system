import 'reflect-metadata';
import '../setup/test-env';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { json } from 'express';
import Redis from 'ioredis';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { GlobalHttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { STRIPE_CLIENT } from '../../src/modules/payments/stripe.provider';
import { EmailService } from '../../src/modules/email/email.service';
import type { SendEmailRequest } from '../../src/modules/email/email.types';
import { StripeStub } from './stripe-stub';

export interface TestContext {
  app: INestApplication;
  httpServer: Server;
  dataSource: DataSource;
  redis: Redis;
  stripeStub: StripeStub;
  /** Every email the app tried to send, in order (nothing leaves the process). */
  sentEmails: SendEmailRequest[];
  /** Templates whose sending should fail (to prove a failed mail does not break the request). */
  failingTemplates: Set<string>;
}

/**
 * Boots a real NestApplication against the test database and Redis,
 * replicating the raw-body middleware wiring from {@code main.ts} so the
 * Stripe webhook endpoint sees `req.rawBody`.
 *
 * The {@code STRIPE_CLIENT} provider is overridden with {@link StripeStub},
 * which keeps the real Stripe signature verifier in place but prevents any
 * network calls to Stripe.
 */
export async function createTestApp(): Promise<TestContext> {
  const stripeStub = new StripeStub();
  const sentEmails: SendEmailRequest[] = [];
  const failingTemplates = new Set<string>();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(STRIPE_CLIENT)
    .useValue(stripeStub)
    .overrideProvider(EmailService)
    .useValue({
      send: (request: SendEmailRequest): Promise<void> => {
        if (failingTemplates.has(request.template)) {
          return Promise.reject(new Error('SMTP down (test)'));
        }
        sentEmails.push(request);
        return Promise.resolve();
      },
    })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    rawBody: true,
    logger: false,
  });

  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.use(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    (
      req: express.Request & { rawBody?: Buffer },
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
      }
      next();
    },
  );
  app.use(json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  await app.init();

  const dataSource = app.get(DataSource);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const httpServer = app.getHttpServer() as Server;

  return { app, httpServer, dataSource, redis, stripeStub, sentEmails, failingTemplates };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
}
