import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcrypt';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import { User } from '../../database/entities';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** A per-account budget of password guesses for one kind of account operation. */
export interface PasswordGuessBudget {
  /** SlidingWindowLimiter scope, e.g. 'pwchange:user'. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const PASSWORD_CHANGE_BUDGET: PasswordGuessBudget = {
  scope: 'pwchange:user',
  limit: 10,
  windowSeconds: 3600,
};

export const EMAIL_CHANGE_BUDGET: PasswordGuessBudget = {
  scope: 'emailchange:user',
  limit: 5,
  windowSeconds: 3600,
};

/**
 * Re-checks the current password for an account operation done while signed in
 * (changing the password, changing the e-mail address). A stolen session alone
 * must not be enough for either.
 *
 * Guesses are throttled per account (not per address: a session can be used
 * from anywhere), every attempt counting. Like the reset limiter it fails
 * closed: with Redis down the attempt is refused with 429.
 *
 * A wrong password is a 400 with `current_password_incorrect`, never a 401:
 * the frontend reads 401 as "your session expired" and would sign the person out.
 */
@Injectable()
export class CurrentPasswordVerifier {
  private readonly logger = new Logger(CurrentPasswordVerifier.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly limiter: SlidingWindowLimiter,
  ) {}

  /** Loads the active account and checks `password` against it. Returns the user on success. */
  async verify(userId: string, password: string, budget: PasswordGuessBudget): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException('Felhasználó nem található.');
    }
    const allowed = await this.limiter.hit(
      budget.scope,
      user.id,
      budget.limit,
      budget.windowSeconds,
    );
    if (!allowed) {
      this.logger.warn(`Password check throttled scope=${budget.scope} user=${user.id}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Túl sok próbálkozás. Próbáld újra később.',
          code: 'rate_limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ok = await compare(password, user.passwordHash);
    if (!ok) {
      this.logger.warn(`Wrong current password scope=${budget.scope} user=${user.id}`);
      throw new BadRequestException({
        statusCode: 400,
        message: 'A jelenlegi jelszó nem megfelelő.',
        code: 'current_password_incorrect',
      });
    }
    return user;
  }
}
