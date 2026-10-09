import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * JWT guard that allows anonymous access — when no Authorization header is
 * present (or the token is invalid) the request continues with `req.user`
 * undefined, instead of returning 401.
 *
 * Used by seat-lock endpoints that support both guest carts (KTE-024) and
 * authenticated users.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      // Cast to TUser — downstream code expects `req.user` to be the
      // authenticated principal or undefined; we model the optional case as
      // `undefined` via this `unknown as TUser` escape.
      return undefined as unknown as TUser;
    }
    return user;
  }
}
