import type { Appearance, StripeElementsOptionsClientSecret } from '@stripe/stripe-js';

/**
 * Family name declared in assets/stripe/stripe-fonts.css. The Payment Element
 * only applies a custom font when the appearance names the very family the
 * stylesheet declares.
 */
export const STRIPE_FONT_FAMILY = "'IBM Plex Sans', system-ui, sans-serif";

/** Path (relative to the app's base href) of the stylesheet handed to Stripe. */
export const STRIPE_FONTS_CSS = 'assets/stripe/stripe-fonts.css';

/**
 * Custom-font option for Stripe Elements. Stripe fetches the stylesheet from
 * inside its own iframe, so the URL must be absolute; it points at this app's
 * own origin, never at a third-party font host.
 *
 * Stripe only applies custom fonts from an HTTPS page, so on plain
 * http://localhost the card form keeps the system-ui fallback named in
 * STRIPE_FONT_FAMILY. On an HTTPS deployment the font and the stylesheet must
 * be CORS-readable (Access-Control-Allow-Origin) because the iframe fetches
 * them from another origin. Chrome's Local Network Access check also stops a
 * public Stripe frame from loading fonts served from localhost.
 */
export function stripeFonts(baseUri: string): NonNullable<StripeElementsOptionsClientSecret['fonts']> {
  return [{ cssSrc: new URL(STRIPE_FONTS_CSS, baseUri).href }];
}

/** Value of a design token (CSS custom property) on :root, or the fallback. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Appearance of the Payment Element. Stripe renders it in an iframe that does
 * not see our CSS custom properties, so the concrete values are read from the
 * design tokens at runtime - the tokens stay the single source. Fields are
 * 50px tall with a 1.5px --border and a 10px radius; labels are 13px/500 in
 * --muted. Stripe's own payment-method tabs are kept (layout 'tabs').
 */
export function stripeAppearance(): Appearance {
  const border = token('--border', '#E7E4EC');
  const brandDeep = token('--brand-deep', '#4A1D6A');
  const ink = token('--ink', '#14121A');
  const muted = token('--muted', '#5B5566');
  const surface = token('--surface', '#FFFFFF');
  const danger = token('--seat-sold', '#8A1C1C');
  return {
    theme: 'stripe',
    labels: 'above',
    variables: {
      colorPrimary: brandDeep,
      colorBackground: surface,
      colorText: ink,
      colorTextSecondary: muted,
      colorDanger: danger,
      fontFamily: STRIPE_FONT_FAMILY,
      borderRadius: '10px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        border: `1.5px solid ${border}`,
        boxShadow: 'none',
        padding: '12px 14px',
        lineHeight: '24px',
        fontSize: '16px',
      },
      '.Input:focus': {
        border: `1.5px solid ${brandDeep}`,
        boxShadow: 'none',
      },
      '.Label': {
        fontSize: '13px',
        fontWeight: '500',
        color: muted,
      },
      '.Tab': {
        border: `1.5px solid ${border}`,
        boxShadow: 'none',
      },
      '.Tab--selected': {
        border: `1.5px solid ${brandDeep}`,
        color: brandDeep,
        boxShadow: 'none',
      },
    },
  };
}
