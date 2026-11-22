import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import type { AuthUser, UserRole } from '../../shared/models/auth.model';
import { AuthService } from './auth.service';
import { stewardOnlyGuard } from './steward.guard';

describe('stewardOnlyGuard', () => {
  function run(user: AuthUser | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { isAuthenticated: signal(user !== null), getCurrentUser: () => user },
        },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      stewardOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }
  const userWith = (role: UserRole): AuthUser => ({ id: 'u', role }) as unknown as AuthUser;

  for (const url of ['/', '/stadium', '/cart', '/checkout', '/profile', '/season-pass', '/loyalty', '/admin']) {
    it(`sends a gate user asking for ${url} back to /gate`, () => {
      const result = run(userWith('gate'));
      expect(result instanceof UrlTree).toBe(true);
      expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/gate');
    });
  }

  for (const role of ['fan', 'admin', 'super_admin'] as const) {
    it(`lets a ${role} through`, () => {
      expect(run(userWith(role))).toBe(true);
    });
  }

  it('lets a signed-out visitor through (the page guards decide)', () => {
    expect(run(null)).toBe(true);
  });
});
