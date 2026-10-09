import { Global, Inject, Logger, Module, OnApplicationShutdown, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '../config';
import { REDIS_CLIENT } from './redis.constants';
import { SeatLockService } from './seat-lock.service';

const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis => {
    const redisConfig = configService.getOrThrow<RedisConfig>('redis');
    const logger = new Logger('RedisClient');

    const client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      keyPrefix: redisConfig.keyPrefix,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    client.on('connect', () =>
      logger.log(`Connected to Redis at ${redisConfig.host}:${redisConfig.port}`),
    );
    client.on('error', (error: Error) =>
      logger.error(`Redis error: ${error.message}`, error.stack),
    );
    client.on('close', () => logger.warn('Redis connection closed'));
    client.on('reconnecting', () => logger.warn('Reconnecting to Redis...'));

    return client;
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisProvider, SeatLockService],
  exports: [REDIS_CLIENT, SeatLockService],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Redis connection on application shutdown...');
    await this.redis.quit().catch((error: unknown) => {
      this.logger.warn(`Redis quit failed: ${error instanceof Error ? error.message : error}`);
    });
  }
}
