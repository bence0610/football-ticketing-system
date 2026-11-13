import type { UserRole } from '../../shared/models/auth.model';

/** The roles allowed into the admin area. One definition, used by the guard and the navigation. */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}
