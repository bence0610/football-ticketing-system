import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, tap } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { HttpContext } from '@angular/common/http';
import { SILENT_401 } from '../interceptors/error.interceptor';
import { AuthApiService } from '../../shared/services/auth.api.service';
import {
  AuthResponse,
  AuthUser,
  LoginPayload,
  RegisterPayload,
} from '../../shared/models/auth.model';

const REFRESH_FALLBACK_KEY = 'kte_refresh_token';
const REFRESH_LEEWAY_MS = 60_000;

/**
 * Centralizes JWT lifecycle: access token kept in memory (signal),
 * refresh token primarily handled via HttpOnly cookie, with a sessionStorage
 * fallback for environments where the cookie cannot be set
 * (e.g. local dev without HTTPS in some browsers).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApiService);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly accessTokenExpiresAt = signal<number | null>(null);
  private readonly currentUser = signal<AuthUser | null>(null);
  private readonly initialized = signal<boolean>(false);

  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly user = computed(() => this.currentUser());
  readonly ready = computed(() => this.initialized());

  private silentRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight$: Observable<AuthResponse | null> | null = null;

  getAccessToken(): string | null {
    return this.accessToken();
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser();
  }

  /**
   * Restore the session at app startup. Tries the refresh endpoint silently;
   * if that fails (no cookie, invalid token), the user simply remains logged out.
   */
  restoreSession(): Observable<AuthResponse | null> {
    const fallbackToken = this.readFallbackToken();
    return this.api.refresh(fallbackToken ?? undefined, new HttpContext().set(SILENT_401, true)).pipe(
      tap((response) => this.applyAuthResponse(response)),
      catchError(() => {
        this.clearLocal();
        return of(null);
      }),
      finalize(() => this.initialized.set(true)),
    );
  }

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.api.register(payload).pipe(tap((res) => this.applyAuthResponse(res)));
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.api.login(payload).pipe(tap((res) => this.applyAuthResponse(res)));
  }

  logout(): Observable<void> {
    const fallbackToken = this.readFallbackToken();
    return this.api.logout(fallbackToken ?? undefined).pipe(
      tap(() => this.clearLocal()),
      tap(() => {
        void this.router.navigate(['/']);
      }),
    );
  }

  /**
   * Returns a one-shot observable that resolves to a refreshed access token,
   * or null if the refresh failed. Multiple concurrent callers share the
   * same in-flight request to avoid token rotation races.
   */
  refresh(): Observable<AuthResponse | null> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const fallbackToken = this.readFallbackToken();
    const obs = this.api.refresh(fallbackToken ?? undefined).pipe(
      tap((res) => this.applyAuthResponse(res)),
      catchError(() => {
        this.clearLocal();
        return of(null);
      }),
      finalize(() => {
        this.refreshInFlight$ = null;
      }),
    );
    this.refreshInFlight$ = obs;
    return obs;
  }

  private applyAuthResponse(response: AuthResponse): void {
    this.accessToken.set(response.accessToken);
    this.accessTokenExpiresAt.set(Date.now() + response.expiresIn * 1000);
    this.currentUser.set(response.user);
    this.writeFallbackToken(response.refreshToken);
    this.scheduleSilentRefresh(response.expiresIn);
    this.initialized.set(true);
  }

  private clearLocal(): void {
    this.accessToken.set(null);
    this.accessTokenExpiresAt.set(null);
    this.currentUser.set(null);
    this.clearFallbackToken();
    if (this.silentRefreshTimer) {
      clearTimeout(this.silentRefreshTimer);
      this.silentRefreshTimer = null;
    }
  }

  private scheduleSilentRefresh(expiresInSeconds: number): void {
    if (this.silentRefreshTimer) {
      clearTimeout(this.silentRefreshTimer);
    }
    const refreshInMs = Math.max(expiresInSeconds * 1000 - REFRESH_LEEWAY_MS, 5_000);
    this.silentRefreshTimer = setTimeout(() => {
      this.refresh().subscribe();
    }, refreshInMs);
  }

  private readFallbackToken(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.sessionStorage.getItem(REFRESH_FALLBACK_KEY);
    } catch {
      return null;
    }
  }

  private writeFallbackToken(token: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.setItem(REFRESH_FALLBACK_KEY, token);
    } catch {
      // sessionStorage may be unavailable (private mode); cookie is the canonical store.
    }
  }

  private clearFallbackToken(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.removeItem(REFRESH_FALLBACK_KEY);
    } catch {
      // ignore
    }
  }
}
