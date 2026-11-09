/**
 * Reads the ticket id (`sub`) out of a signed QR token without verifying it —
 * the scan endpoint needs the id in the URL and does the verifying itself.
 * Returns null for anything that is not a three-part, JSON-payload token.
 */
export function extractTicketId(token: string): string | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
