/**
 * What the owner of an account is told about where a change came from, so a
 * stranger's reset is recognisable at a glance. There is no GeoIP database in
 * the system, so "roughly where" is the network address with its last part
 * hidden - enough to tell "my phone on my home network" from somewhere else,
 * without printing a full address into an email - plus the browser and system.
 */
export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/** 84.2.51.77 -> "84.2.51.x"; 2a02:ab88:1234:5678::1 -> "2a02:ab88:1234:x". Anything else is left out. */
export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/i, '');
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((g) => g.length > 0);
    if (groups.length >= 2) {
      return `${groups.slice(0, 3).join(':')}:x`;
    }
  }
  return undefined;
}

/** "Chrome, Windows" from a User-Agent, or undefined when it says nothing recognisable. */
export function describeBrowser(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : undefined;
  const system = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : undefined;
  const parts = [browser, system].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** "Chrome, Windows · 84.2.51.x", with whichever part is known; undefined when neither is. */
export function describeClient(client: ClientInfo | undefined): string | undefined {
  if (!client) return undefined;
  const parts = [describeBrowser(client.userAgent), maskIp(client.ip)].filter(
    (p): p is string => !!p,
  );
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
