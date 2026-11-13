/**
 * The name to show for a sector. The server sends it (the `sectors` table is
 * the single source), so callers pass it when they have it; this is only the
 * fallback for data that carries a bare code (an old cart item, a response
 * without a sector row). It replaces the five separate "VIP has no szektor
 * suffix" special cases the UI used to carry.
 */
export function sectorName(code: string, name?: string | null): string {
  if (name) return name;
  if (code === 'VIP') return 'VIP';
  if (code === 'VENDÉG') return 'Vendég szektor';
  return `${code} szektor`;
}
