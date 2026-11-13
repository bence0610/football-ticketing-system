export interface AdminNavItem {
  readonly label: string;
  readonly route: string;
  readonly icon: string;
}

export interface AdminNavGroup {
  readonly label: string;
  readonly items: readonly AdminNavItem[];
}

/**
 * The sidebar, and only pages that exist. A page is listed here when its route
 * is registered in admin.routes.ts and an endpoint feeds it.
 *
 * The design also has a "Kezelés" group (Mérkőzések, Felhasználók, Beléptetési
 * napló). None of the three has a page, and two have no data to build one from:
 * there is no admin user list (only a public registration counter) and no scan
 * log (a scan only stamps the ticket). They are left out rather than shown as
 * dead links; add them here together with their route.
 */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: 'Áttekintés',
    items: [
      { label: 'Bevétel', route: '/admin/revenue', icon: 'payments' },
      { label: 'Ülés-hőtérkép', route: '/admin/heatmap', icon: 'grid_view' },
    ],
  },
];

/** Groups with at least one item: an empty group would be a heading over nothing. */
export function visibleNavGroups(groups: readonly AdminNavGroup[]): readonly AdminNavGroup[] {
  return groups.filter((g) => g.items.length > 0);
}
