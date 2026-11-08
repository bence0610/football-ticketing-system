/**
 * The seat-hold length is owned by the backend (`SEAT_LOCK_TTL_SECONDS`) and
 * reaches the client as `ttlSeconds` on the lock response. Everything the user
 * sees about the hold — the cart text and the countdown — is derived from that
 * single value through the helpers below; never hard-code a duration in a
 * template.
 */

/** Epoch ms at which a lock granted *now* with `ttlSeconds` runs out. Uses the
 * client clock so a skewed browser clock cannot distort the countdown. */
export function lockExpiryFromTtl(ttlSeconds: number, nowMs: number = Date.now()): number {
  return nowMs + ttlSeconds * 1000;
}

/** Hungarian human duration for the cart notice: "5 perc", "1 perc 30 másodperc". */
export function formatHoldDuration(ttlSeconds: number): string {
  const total = Math.max(0, Math.round(ttlSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (minutes > 0) {
    parts.push(`${minutes} perc`);
  }
  if (seconds > 0 || minutes === 0) {
    parts.push(`${seconds} másodperc`);
  }
  return parts.join(' ');
}

/** Cart notice text for a hold of `ttlSeconds` (or a generic one when unknown). */
export function holdNoticeText(ttlSeconds: number | null | undefined): string {
  const duration = ttlSeconds ? `${formatHoldDuration(ttlSeconds)}ig érvényes` : 'korlátozott ideig érvényes';
  return `A foglalás ${duration} — ezalatt fejezd be a fizetést, különben a szék felszabadul.`;
}

/**
 * Live "time left" for a hold as a Hungarian duration with the -ig suffix:
 * "3 perc 12 másodpercig", "45 másodpercig". Built from the same
 * formatHoldDuration() as the cart notice, so the number is only ever the
 * server-granted hold counting down.
 */
export function holdRemainingText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${formatHoldDuration(seconds)}ig`;
}
