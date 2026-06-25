import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { AppShellComponent } from './core/layout/app-shell/app-shell.component';

export const APP_ROUTES: Routes = [
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
        path: 'profile',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/profile/profile.page').then((m) => m.ProfilePageComponent),
        title: 'Profil',
      },
      {
        path: 'loyalty',
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
