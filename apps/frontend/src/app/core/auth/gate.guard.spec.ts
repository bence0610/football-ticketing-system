import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import type { AuthUser, UserRole } from '../../shared/models/auth.model';
import { AuthService } from './auth.service';
import { gateGuard } from './gate.guard';

describe('gateGuard', () => {
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
      gateGuard({} as ActivatedRouteSnapshot, { url: '/gate' } as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }
  const userWith = (role: UserRole): AuthUser => ({ id: 'u', role }) as unknown as AuthUser;

  for (const role of ['gate', 'admin', 'super_admin'] as const) {
    it(`lets a ${role} in`, () => expect(run(userWith(role))).toBe(true));
  }

  it('turns a fan away to the home page', () => {
    const result = run(userWith('fan'));
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });
});
