import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { UserRole } from '../../../database/entities';
import { GATE_ALLOWED_KEY } from '../decorators/gate-allowed.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Whether a gate user may call this route: only when the handler (or its
 * controller) is marked `@GateAllowed()` or names the gate role in `@Roles`.
 * Pure metadata lookup, so the route-protection test can audit every route
 * with the same function the interceptor uses.
 */
export function gateMayUse(handler: object, controller: object): boolean {
  const roles =
    (Reflect.getMetadata(ROLES_KEY, handler) as UserRole[] | undefined) ??
    (Reflect.getMetadata(ROLES_KEY, controller) as UserRole[] | undefined);
  if (roles?.includes(UserRole.GATE)) return true;
  return Boolean(
    Reflect.getMetadata(GATE_ALLOWED_KEY, handler) ??
    Reflect.getMetadata(GATE_ALLOWED_KEY, controller),
  );
}

/**
 * Global, default-closed rule for the steward account. Guards have already put
 * the JWT principal on the request when an interceptor runs, so this sees
 * every authenticated call (including optional-JWT routes with a token) and
 * refuses a gate user wherever the route is not explicitly open to stewards.
 * Anonymous public routes carry no principal and are not affected.
 */
@Injectable()
export class GateLockoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
      if (user?.role === UserRole.GATE && !gateMayUse(context.getHandler(), context.getClass())) {
        throw new ForbiddenException('A belépőkezelő fiók csak a beléptetést használhatja.');
      }
    }
    return next.handle();
  }
}
