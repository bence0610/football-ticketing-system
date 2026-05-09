import { Routes } from '@angular/router';
import { AdminPageComponent } from './admin.page';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminPageComponent,
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
        title: 'Admin - Bevételi statisztikák',
      },
      {
        path: 'heatmap',
        loadComponent: () =>
          import('./heatmap/seat-heatmap.page').then((m) => m.SeatHeatmapPageComponent),
        title: 'Admin - Foglaltsági heatmap',
      },
    ],
  },
];
