import { Routes } from '@angular/router';
import { AdminShellComponent } from './admin-shell.component';

/**
 * Every route here is a read-only page. A new page needs a matching entry in
 * admin-nav.ts, and a backend endpoint that is behind the admin role.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'revenue',
      },
      {
        path: 'revenue',
        loadComponent: () =>
          import('./revenue/revenue-stats.page').then((m) => m.RevenueStatsPageComponent),
        title: 'Admin - Bevétel',
      },
      {
        path: 'heatmap',
        loadComponent: () =>
          import('./heatmap/seat-heatmap.page').then((m) => m.SeatHeatmapPageComponent),
        title: 'Admin - Ülés-hőtérkép',
      },
      {
        // An unknown admin address stays inside the admin shell.
        path: '**',
        redirectTo: 'revenue',
      },
    ],
  },
];
