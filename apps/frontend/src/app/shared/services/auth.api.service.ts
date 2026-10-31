import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuthResponse,
  LoginPayload,
  RegisterPayload,
  UserProfile,
  UserTicketsPage,
} from '../models/auth.model';
import { SKIP_ERROR_SNACKBAR } from '../../core/interceptors/error.interceptor';

const WITH_CREDENTIALS = { withCredentials: true } as const;

const FORM_CONTEXT = new HttpContext().set(SKIP_ERROR_SNACKBAR, true);

/**
 * Thin HTTP wrapper around `/auth/*` and `/users/*`. Always sends credentials
 * so the HttpOnly refresh-token cookie is included on cross-origin calls.
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/auth/register', payload, {
      ...WITH_CREDENTIALS,
      context: FORM_CONTEXT,
    });
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/auth/login', payload, {
      ...WITH_CREDENTIALS,
      context: FORM_CONTEXT,
    });
  }

  refresh(refreshToken?: string, context?: HttpContext): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      '/auth/refresh',
      { refreshToken: refreshToken ?? '' },
      context ? { ...WITH_CREDENTIALS, context } : WITH_CREDENTIALS,
    );
  }

  logout(refreshToken?: string): Observable<void> {
    return this.http.post<void>(
      '/auth/logout',
      { refreshToken: refreshToken ?? '' },
      WITH_CREDENTIALS,
    );
  }

  me(): Observable<UserProfile> {
    return this.http.get<UserProfile>('/users/me', WITH_CREDENTIALS);
  }

  myTickets(limit = 20, offset = 0): Observable<UserTicketsPage> {
    const params = new HttpParams().set('limit', String(limit)).set('offset', String(offset));
    return this.http.get<UserTicketsPage>('/users/me/tickets', {
      params,
      ...WITH_CREDENTIALS,
    });
  }

  updateProfile(payload: Partial<{ firstName: string; lastName: string; phoneNumber: string }>): Observable<UserProfile> {
    return this.http.patch<UserProfile>('/users/me', payload, WITH_CREDENTIALS);
  }
}
