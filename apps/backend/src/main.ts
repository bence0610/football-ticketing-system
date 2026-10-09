import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { json } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    bodyParser: false,
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Stripe requires the *raw* request body to verify webhook signatures.
  // We register a raw bodyParser strictly for the webhook routes, then JSON
  // for everything else.
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

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('KTE Jegyportál API')
    .setDescription('Hivatalos jegyértékesítési és bérletkezelő API a Kecskeméti TE számára.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('Health')
    .addTag('Auth')
    .addTag('Users')
    .addTag('Matches')
    .addTag('Seats')
    .addTag('Tickets')
    .addTag('Loyalty')
    .addTag('Waitlist')
    .addTag('Admin')
    .addTag('Chatbot')
    .addTag('Payments')
    .addTag('Weather')
    .addTag('SeasonPasses')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  await app.listen(appConfig.port);

  const logger = new Logger('Bootstrap');
  logger.log(`KTE backend listening on ${appConfig.appUrl}`);
  logger.log(`Swagger docs:        ${appConfig.appUrl}/api/docs`);
  logger.log(`Environment:         ${appConfig.nodeEnv}`);
}

void bootstrap();
