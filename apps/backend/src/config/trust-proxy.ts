/**
 * The Express `trust proxy` setting, read from the TRUST_PROXY environment
 * variable (never hard-coded).
 *
 * Why it matters here: the IP-based rate limits (password reset, chatbot, the
 * RateLimit guard) key on `req.ip`. Behind a reverse proxy the socket address is
 * the proxy's, so without `trust proxy` every visitor shares one budget; with
 * it set too loosely, a caller can send their own `X-Forwarded-For` and get a
 * fresh budget on every request. The value therefore says exactly how many
 * proxies (or which addresses) to believe.
 *
 * Accepted values:
 *   - unset, empty, `false`, `0`   -> not behind a proxy (the default; local
 *                                     development). `req.ip` is the socket
 *                                     address and X-Forwarded-For is ignored.
 *   - an integer N >= 1            -> exactly N proxy hops sit in front of the
 *                                     app (e.g. `1` behind one nginx / load
 *                                     balancer). `req.ip` is the address the
 *                                     outermost trusted proxy saw.
 *   - a comma-separated list of IPs, CIDR ranges or Express names
 *     (`loopback`, `linklocal`, `uniquelocal`) -> trust only proxies from those addresses.
 * Bare `true` is REFUSED: it trusts every hop, so the leftmost (caller-supplied)
 * X-Forwarded-For entry becomes `req.ip` and the limits can be bypassed.
 */
export type TrustProxySetting = false | number | string;

export function parseTrustProxy(raw: string | undefined | null): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') {
    return false;
  }
  if (value.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true is not accepted: it trusts every X-Forwarded-For hop, so callers could pick their own IP and escape the rate limits. Use the number of proxy hops (e.g. 1) or a list of proxy addresses.',
    );
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }
  const entries = value.split(',').map((e) => e.trim());
  if (entries.some((e) => e === '' || /\s/.test(e))) {
    throw new Error(`TRUST_PROXY "${value}" is not a hop count or a comma-separated list of addresses.`);
  }
  return entries.join(',');
}
