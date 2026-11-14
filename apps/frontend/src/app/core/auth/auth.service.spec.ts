import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthResponse, AuthUser } from '../../shared/models/auth.model';
import { AuthService } from './auth.service';

const USER: AuthUser = {
  id: 'u-1',
  email: 'bela@kte.hu',
  firstName: 'Béla',
  lastName: 'Kovács',
  role: 'fan',
  loyaltyTier: 'bronze',
  loyaltyPoints: 10,
};

function session(accessToken: string, refreshToken: string, user: AuthUser = USER): AuthResponse {
  return { accessToken, refreshToken, expiresIn: 900, user };
}

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.removeItem('kte_refresh_token');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.removeItem('kte_refresh_token');
  });

  function signIn(): void {
    service.login({ email: USER.email, password: 'Jelszo123' }).subscribe();
    http.expectOne('/auth/login').flush(session('access-old', 'refresh-old'));
  }

  describe('changePassword', () => {
    it('applies the fresh token pair exactly like a login, so this session stays signed in', () => {
      signIn();
      expect(service.getAccessToken()).toBe('access-old');

      let answered = false;
      service
        .changePassword({ currentPassword: 'Jelszo123', newPassword: 'UjJelszo456' })
        .subscribe(() => (answered = true));
      const req = http.expectOne('/auth/change-password');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ currentPassword: 'Jelszo123', newPassword: 'UjJelszo456' });
      expect(req.request.withCredentials).toBeTrue();
      req.flush(session('access-new', 'refresh-new'));

      expect(answered).toBeTrue();
      expect(service.isAuthenticated()).toBeTrue();
      expect(service.getAccessToken()).toBe('access-new');
      expect(sessionStorage.getItem('kte_refresh_token')).toBe('refresh-new');
      expect(service.user()?.email).toBe(USER.email);
    });

    it('a refused change leaves the session as it was', () => {
      signIn();
      service.changePassword({ currentPassword: 'rossz', newPassword: 'UjJelszo456' }).subscribe({
        error: () => undefined,
      });
      http
        .expectOne('/auth/change-password')
        .flush({ code: 'current_password_incorrect', message: 'x' }, { status: 400, statusText: 'Bad Request' });
      expect(service.getAccessToken()).toBe('access-old');
      expect(sessionStorage.getItem('kte_refresh_token')).toBe('refresh-old');
    });
  });

  describe('syncProfile', () => {
    it('updates the signed-in user (name, e-mail) in place', () => {
      signIn();
      service.syncProfile({ id: 'u-1', email: 'uj@kte.hu', firstName: 'Bence', lastName: 'Nagy' });
      expect(service.user()).toEqual(
        jasmine.objectContaining({ id: 'u-1', email: 'uj@kte.hu', firstName: 'Bence', lastName: 'Nagy', role: 'fan' }),
      );
      expect(service.getAccessToken()).toBe('access-old');
    });

    it("ignores another account's profile and does nothing when signed out", () => {
      service.syncProfile({ id: 'u-1', email: 'uj@kte.hu', firstName: 'B', lastName: 'N' });
      expect(service.user()).toBeNull();
      signIn();
      service.syncProfile({ id: 'u-2', email: 'masik@kte.hu', firstName: 'X', lastName: 'Y' });
      expect(service.user()?.email).toBe(USER.email);
    });
  });
});
