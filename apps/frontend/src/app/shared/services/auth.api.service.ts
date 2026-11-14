import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuthResponse,
  ChangePasswordPayload,
  EmailChangeConfirmed,
  EmailChangePayload,
  EmailChangeRequested,
  LoginPayload,
  ProfileUpdatePayload,
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

  /** Always answers the same, whether or not the address has an account. */
  requestPasswordReset(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/auth/password-reset/request', { email }, {
      context: FORM_CONTEXT,
    });
  }

  /** Is the emailed link still usable? Nothing is consumed. Errors carry the server's `code`. */
  checkPasswordResetToken(token: string): Observable<void> {
    return this.http.get<void>(`/auth/password-reset/${encodeURIComponent(token)}`, {
      context: FORM_CONTEXT,
    });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/auth/password-reset/confirm', { token, password }, {
      context: FORM_CONTEXT,
    });
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

  updateProfile(payload: ProfileUpdatePayload): Observable<UserProfile> {
    return this.http.patch<UserProfile>('/users/me', payload, {
      ...WITH_CREDENTIALS,
      context: FORM_CONTEXT,
    });
  }

  /**
   * Answers like a login: a fresh token pair for this session (every other
   * session loses its refresh token). AuthService.changePassword applies it.
   */
  changePassword(payload: ChangePasswordPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/auth/change-password', payload, {
      ...WITH_CREDENTIALS,
      context: FORM_CONTEXT,
    });
  }

  /** 202: a link goes to the new address; `email` does not change until it is opened. */
  requestEmailChange(payload: EmailChangePayload): Observable<EmailChangeRequested> {
    return this.http.post<EmailChangeRequested>('/users/me/email-change', payload, {
      ...WITH_CREDENTIALS,
      context: FORM_CONTEXT,
    });
  }

  /** Public: the emailed link works in any browser, signed in or not. */
  confirmEmailChange(token: string): Observable<EmailChangeConfirmed> {
    return this.http.post<EmailChangeConfirmed>('/auth/confirm-email-change', { token }, {
      context: FORM_CONTEXT,
    });
  }
}
