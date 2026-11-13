import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import type { AuthUser, UserRole } from '../../shared/models/auth.model';
import { adminGuard } from './admin.guard';
import { AuthService } from './auth.service';

describe('adminGuard', () => {
  function run(user: AuthUser | null, authenticated = user !== null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { isAuthenticated: signal(authenticated), getCurrentUser: () => user },
        },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, { url: '/admin/revenue' } as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  const userWith = (role: UserRole): AuthUser =>
    ({ id: 'u', email: 'u@kte.hu', firstName: 'T', lastName: 'U', role }) as unknown as AuthUser;

  for (const role of ['admin', 'super_admin'] as const) {
    it(`lets a ${role} in`, () => {
      expect(run(userWith(role))).toBe(true);
    });
  }

  for (const role of ['fan', 'gate'] as const) {
    it(`turns a ${role} away to the home page`, () => {
      const result = run(userWith(role));
      expect(result instanceof UrlTree).toBe(true);
      expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
    });
  }

  it('sends an anonymous visitor to the login with a way back', () => {
    const result = run(null);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/login?returnUrl=%2Fadmin%2Frevenue',
    );
  });
});
