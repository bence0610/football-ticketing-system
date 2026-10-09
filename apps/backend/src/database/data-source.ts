import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env') });

const baseOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'kte_jegyportal',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [resolve(__dirname, 'entities/*.entity.{ts,js}')],
  migrations: [resolve(__dirname, 'migrations/*.{ts,js}')],
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
};

export default new DataSource(baseOptions);
