import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole } from '../../../database/entities';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Authorizes the current request against the {@link Roles} decorator. If the
 * route declares no roles, the guard is a no-op (open). When roles are
 * declared, the JWT principal is required and its `role` must be in the list,
 * otherwise a 403 ForbiddenException is thrown.
 *
 * MUST be combined with {@link JwtAuthGuard} (or a JWT-attaching guard) so
 * that `req.user` is populated when this guard runs.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Hiányzó hitelesítés a védett végponton.');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Nincs jogosultság ehhez a művelethez.');
    }
    return true;
  }
}
