import { registerAs } from '@nestjs/config';
import { parseTrustProxy, TrustProxySetting } from './trust-proxy';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appName: string;
  appUrl: string;
  frontendUrl: string;
  corsOrigins: string[];
  logLevel: string;
  homeTeamName: string;
  /** Express `trust proxy`, from TRUST_PROXY (see trust-proxy.ts). Default false: not behind a proxy. */
  trustProxy: TrustProxySetting;
}

export default registerAs(
  'app',
  (): AppConfig => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    appName: process.env.APP_NAME ?? 'KTE Jegyportal API',
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4200',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    homeTeamName: process.env.HOME_TEAM_NAME ?? 'Kecskeméti TE',
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  }),
);
