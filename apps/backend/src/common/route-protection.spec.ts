import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join as joinPath } from 'path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type Type } from '@nestjs/common';
import { UserRole } from '../database/entities';
import { AdminController } from '../modules/admin/admin.controller';
import { AuthController } from '../modules/auth/auth.controller';
import { PasswordResetController } from '../modules/auth/password-reset.controller';
import { ROLES_KEY } from '../modules/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../modules/auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { ChatbotController } from '../modules/chatbot/chatbot.controller';
import { HealthController } from '../modules/health/health.controller';
import { LoyaltyController } from '../modules/loyalty/loyalty.controller';
import { MatchesController } from '../modules/matches/matches.controller';
import { PaymentsController } from '../modules/payments/payments.controller';
import { StripeWebhookController } from '../modules/payments/stripe-webhook.controller';
import { SeasonPassesController } from '../modules/season-passes/season-passes.controller';
import { MatchSeatsController } from '../modules/seats/match-seats.controller';
import { SeatsController } from '../modules/seats/seats.controller';
import { TicketsController } from '../modules/tickets/tickets.controller';
import { UsersController } from '../modules/users/users.controller';
import { WaitlistController } from '../modules/waitlist/waitlist.controller';
import { WeatherController } from '../modules/weather/weather.controller';

/**
 * Backend route-protection audit, enforced.
 *
 * A frontend route guard stops nobody who calls the API directly, so every
 * controller route must either require a verified JWT or be named in
 * PUBLIC_ROUTES below, with the reason it is open. Adding a new unguarded
 * endpoint fails this test until someone writes that reason down.
 *
 * Roles are checked separately: routes that expose business-wide data or act
 * for staff must be behind RolesGuard with the right role list.
 */

// Every controller in the app. A new controller must be added here — the
// completeness check below fails if the app has a controller this list lacks.
const CONTROLLERS: Type<unknown>[] = [
  AdminController,
  AuthController,
  PasswordResetController,
  ChatbotController,
  HealthController,
  LoyaltyController,
  MatchesController,
  MatchSeatsController,
  PaymentsController,
  SeasonPassesController,
  SeatsController,
  StripeWebhookController,
  TicketsController,
  UsersController,
  WaitlistController,
  WeatherController,
];

/** Routes that are reachable without a JWT on purpose, and why. */
const PUBLIC_ROUTES: Record<string, string> = {
  'POST auth/register': 'account creation',
  'POST auth/login': 'obtains the token',
  'POST auth/refresh': 'authenticates with the refresh token in the body',
  'POST auth/password-reset/request':
    'asks for a reset link by email; answers the same for every address and is rate limited',
  'GET auth/password-reset/:token':
    'checks an emailed reset link; the secret one-time token is the credential',
  'POST auth/password-reset/confirm':
    'sets the new password; authorised by the secret one-time token from the email',
  'POST chatbot/message':
    'guests may chat; OptionalJwtAuthGuard binds the conversation to the identity',
  'GET health': 'liveness probe, returns only up/down',
  'GET loyalty/tiers': 'static tier table, same for everyone',
  'GET matches': 'public fixture list',
  'GET matches/upcoming': 'public fixture list',
  'GET matches/:id': 'public fixture detail',
  'GET matches/:matchId/seats': 'public seat map (free/sold only, no buyer data)',
  'POST matches/:matchId/seats/:seatId/lock': 'guest carts; proves ownership with ownerToken',
  'POST matches/:matchId/seats/:seatId/lock/extend': 'guest carts; requires the ownerToken',
  'DELETE matches/:matchId/seats/:seatId/lock': 'guest carts; releases only with the ownerToken',
  'GET seats': 'static seat catalogue',
  'POST webhooks/stripe': 'authenticated by the Stripe signature, not a JWT',
  'GET season-passes/prices': 'public price list',
  'GET season-passes/season': 'public home fixture list and loyalty reward of the season',
  'GET season-passes/loans/preview/:token':
    'invitation link; possession of the secret token is the credential',
  'GET users/count': 'deliberately public registration counter',
  'GET weather/match/:matchId': 'public forecast',
};

/** Routes that must additionally be restricted to these roles. */
const ADMIN_ONLY = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
const REQUIRED_ROLES: Record<string, UserRole[]> = {
  'GET admin/health': ADMIN_ONLY,
  'GET admin/revenue': ADMIN_ONLY,
  'GET admin/matches/:matchId/occupancy': ADMIN_ONLY,
  'GET tickets/count': ADMIN_ONLY,
  'GET loyalty/transactions/count': ADMIN_ONLY,
  'PATCH tickets/:id/scan': [UserRole.GATE, UserRole.ADMIN, UserRole.SUPER_ADMIN],
};

interface RouteInfo {
  key: string;
  authenticated: boolean;
  usesRolesGuard: boolean;
  roles: UserRole[];
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

const join = (...parts: string[]): string =>
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

// AuthGuard('jwt') returns a mixin class; that is how
// `@UseGuards(AuthGuard('jwt'))` shows up in the metadata.
function isRequiredJwtGuard(guard: unknown): boolean {
  if (typeof guard !== 'function') return false;
  if (guard === OptionalJwtAuthGuard || guard.prototype instanceof OptionalJwtAuthGuard) {
    return false;
  }
  // The mixin class has a generated name, so recognise it by its passport API.
  const isPassportGuard =
    'handleRequest' in guard.prototype && 'getAuthenticateOptions' in guard.prototype;
  return guard === JwtAuthGuard || guard.prototype instanceof JwtAuthGuard || isPassportGuard;
}

function collectRoutes(controller: Type<unknown>): RouteInfo[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
  const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as UserRole[] | undefined;
  const routes: RouteInfo[] = [];

  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    if (method === undefined) continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
    const guards = [
      ...classGuards,
      ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
    ];
    routes.push({
      key: `${METHOD_NAMES[method]} ${join(base, path)}`,
      authenticated: guards.some(isRequiredJwtGuard),
      usesRolesGuard: guards.includes(RolesGuard),
      roles:
        (Reflect.getMetadata(ROLES_KEY, handler) as UserRole[] | undefined) ?? classRoles ?? [],
    });
  }
  return routes;
}

const ROUTES = CONTROLLERS.flatMap(collectRoutes);

describe('backend route protection', () => {
  it('covers every controller file in the codebase', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = joinPath(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.controller.ts')) found.push(entry);
      }
    };
    walk(joinPath(__dirname, '..'));
    expect(found).toHaveLength(CONTROLLERS.length);
  });

  it('inspects a plausible number of routes (the audit itself is not vacuous)', () => {
    expect(ROUTES.length).toBeGreaterThan(40);
  });

  it('every route requires a JWT unless it is on the documented public list', () => {
    const exposed = ROUTES.filter((r) => !r.authenticated && !(r.key in PUBLIC_ROUTES)).map(
      (r) => r.key,
    );
    expect(exposed).toEqual([]);
  });

  it('every entry on the public list is a real route, and really is unauthenticated', () => {
    const byKey = new Map(ROUTES.map((r) => [r.key, r]));
    const stale = Object.keys(PUBLIC_ROUTES).filter((k) => !byKey.has(k));
    expect(stale).toEqual([]);
    const notPublic = Object.keys(PUBLIC_ROUTES).filter((k) => byKey.get(k)?.authenticated);
    expect(notPublic).toEqual([]);
  });

  it.each(Object.entries(REQUIRED_ROLES))(
    '%s is restricted to the right roles',
    (key, expectedRoles) => {
      const route = ROUTES.find((r) => r.key === key);
      expect(route).toBeDefined();
      expect(route!.authenticated).toBe(true);
      expect(route!.usesRolesGuard).toBe(true);
      expect([...route!.roles].sort()).toEqual([...expectedRoles].sort());
      expect(route!.roles).not.toContain(UserRole.FAN);
    },
  );

  it('every admin route is covered by the role table', () => {
    const adminRoutes = ROUTES.filter((r) => r.key.split(' ')[1].startsWith('admin')).map(
      (r) => r.key,
    );
    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(adminRoutes.filter((k) => !(k in REQUIRED_ROLES))).toEqual([]);
  });

  it('no route uses a role list without RolesGuard (a @Roles that enforces nothing)', () => {
    const decorativeOnly = ROUTES.filter((r) => r.roles.length > 0 && !r.usesRolesGuard).map(
      (r) => r.key,
    );
    expect(decorativeOnly).toEqual([]);
  });
});
