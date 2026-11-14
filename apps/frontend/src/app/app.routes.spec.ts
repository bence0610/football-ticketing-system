import { Route } from '@angular/router';
import { APP_ROUTES } from './app.routes';
import { authGuard } from './core/auth/auth.guard';

/** The children of the AppShell route, where every public and fan page lives. */
function shellRoute(path: string): Route | undefined {
  const shell = APP_ROUTES.find((r) => r.path === '' && r.children);
  return shell?.children?.find((r) => r.path === path);
}

describe('APP_ROUTES (account pages)', () => {
  for (const [path, title, component] of [
    ['profile/details', 'Adataim szerkesztése', 'ProfileDetailsPageComponent'],
    ['profile/password', 'Jelszó módosítása', 'ChangePasswordPageComponent'],
  ] as const) {
    it(`${path} is lazy, guarded by authGuard, and titled "${title}"`, async () => {
      const route = shellRoute(path);
      expect(route).toBeDefined();
      expect(route!.canActivate).toEqual([authGuard]);
      expect(route!.title).toBe(title);
      expect(route!.component).toBeUndefined();
      const loaded = (await route!.loadComponent!()) as { name: string };
      expect(loaded.name).toBe(component);
    });
  }

  it('confirm-email/:token is lazy and public (no guard), like reset-password/:token', async () => {
    const route = shellRoute('confirm-email/:token');
    expect(route).toBeDefined();
    expect(route!.canActivate).toBeUndefined();
    expect(shellRoute('reset-password/:token')!.canActivate).toBeUndefined();
    expect(route!.title).toBe('E-mail-cím megerősítése');
    const loaded = (await route!.loadComponent!()) as { name: string };
    expect(loaded.name).toBe('ConfirmEmailPageComponent');
  });

  it('the account pages come before the wildcard', () => {
    const shell = APP_ROUTES.find((r) => r.path === '' && r.children)!;
    const paths = shell.children!.map((r) => r.path);
    const wildcard = paths.indexOf('**');
    for (const p of ['profile/details', 'profile/password', 'confirm-email/:token']) {
      expect(paths.indexOf(p)).toBeGreaterThan(-1);
      expect(paths.indexOf(p)).toBeLessThan(wildcard);
    }
  });
});
