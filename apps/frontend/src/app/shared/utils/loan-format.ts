/**
 * Wording helpers shared by the lending screens (profile banner, accept page,
 * owner's pass card), so the same fact is always phrased the same way.
 */

const BUDAPEST = 'Europe/Budapest';

/** "2 nap", "5 óra", "40 perc" until the instant; `null` once it has passed. */
export function timeLeft(expiresIso: string, now: number = Date.now()): string | null {
  const diff = new Date(expiresIso).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} perc`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} óra`;
  return `${Math.floor(hours / 24)} nap`;
}

/** "még 2 nap" - or "lejárt" when there is nothing left. */
export function timeLeftLabel(expiresIso: string, now: number = Date.now()): string {
  const left = timeLeft(expiresIso, now);
  return left ? `még ${left}` : 'lejárt';
}

/** "2026. november 15., 18:00" in the stadium's timezone. */
export function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString('hu-HU', {
    timeZone: BUDAPEST,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "B szektor · 3. sor · 12. szék" */
export function loanSeatLabel(seat: { seatSection: string; seatRow: string; seatNumber: number }): string {
  return `${seat.seatSection} szektor · ${seat.seatRow}. sor · ${seat.seatNumber}. szék`;
}
