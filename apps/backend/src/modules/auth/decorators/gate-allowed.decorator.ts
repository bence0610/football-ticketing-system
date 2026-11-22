import { SetMetadata } from '@nestjs/common';

export const GATE_ALLOWED_KEY = 'gateAllowed';

/**
 * Opens an authenticated route to the steward account (role `gate`) as well.
 *
 * The gate role is closed by default: {@link GateLockoutInterceptor} refuses a
 * gate user (403) on every route unless the route is marked with this
 * decorator or lists the gate role in its `@Roles(...)`. A new endpoint is
 * therefore closed for stewards until someone opens it on purpose.
 */
export const GateAllowed = (): MethodDecorator & ClassDecorator =>
  SetMetadata(GATE_ALLOWED_KEY, true);
