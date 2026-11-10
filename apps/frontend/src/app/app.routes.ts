import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { gateGuard } from './core/auth/gate.guard';
import { AppShellComponent } from './core/layout/app-shell/app-shell.component';

export const APP_ROUTES: Routes = [
  // The gate is deliberately outside AppShell: a steward's screen has no
  // header, navigation, profile or chat bubble - nothing to press by accident.
  // It must come before the shell route, whose wildcard child would catch it.
  {
    path: 'gate',
    canActivate: [gateGuard],
    loadComponent: () => import('./features/gate/gate.page').then((m) => m.GatePageComponent),
    title: 'Beléptető',
  },
  {
    path: '',
    component: AppShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/home/home.page').then((m) => m.HomePageComponent),
        title: 'KTE Jegyportál - Kezdőlap',
      },
      {
        path: 'stadium',
        loadComponent: () =>
          import('./features/stadium/stadium.page').then((m) => m.StadiumPageComponent),
        title: 'Stadion - Helyválasztás',
      },
      {
        path: 'cart',
        loadComponent: () =>
          import('./features/cart/cart.page').then((m) => m.CartPageComponent),
        title: 'Kosár',
      },
      {
        path: 'checkout',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/checkout/checkout.page').then((m) => m.CheckoutPageComponent),
        title: 'Fizetés',
      },
      {
        path: 'checkout/confirmation',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/checkout/confirmation.page').then((m) => m.ConfirmationPageComponent),
        title: 'Rendelés visszaigazolva',
      },
      {
        path: 'login',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/login.page').then((m) => m.LoginPageComponent),
        title: 'Bejelentkezés',
      },
      {
        path: 'register',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/register.page').then((m) => m.RegisterPageComponent),
        title: 'Regisztráció',
      },
      {
        // Reachable signed in or out: the emailed link must work in whatever session the browser has.
        path: 'forgot-password',
        loadComponent: () =>
          import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPageComponent),
        title: 'Elfelejtett jelszó',
      },
      {
        path: 'reset-password/:token',
        loadComponent: () =>
          import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPageComponent),
        title: 'Új jelszó beállítása',
      },
      {
        path: 'profile',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/profile/profile.page').then((m) => m.ProfilePageComponent),
        title: 'Profil',
      },
      {
        path: 'loyalty',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/loyalty/loyalty-dashboard.page').then((m) => m.LoyaltyDashboardPageComponent),
        title: 'Hűség Dashboard',
      },
      {
        path: 'season-pass',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/season-pass/season-pass.page').then((m) => m.SeasonPassPageComponent),
        title: 'Bérlet vásárlás',
      },
      {
        path: 'season-pass/confirmation',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/season-pass/confirmation.page').then(
            (m) => m.SeasonPassConfirmationPageComponent,
          ),
        title: 'Sikeres bérletvásárlás',
      },
      {
        path: 'loans/accept/:token',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/loans/accept-loan.page').then((m) => m.AcceptLoanPageComponent),
        title: 'Bérletkölcsön elfogadása',
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadChildren: () =>
          import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
        title: 'Admin',
      },
      {
        path: '**',
        loadComponent: () =>
          import('./features/not-found/not-found.page').then((m) => m.NotFoundPageComponent),
        title: '404 - Az oldal nem található',
      },
    ],
  },
];
