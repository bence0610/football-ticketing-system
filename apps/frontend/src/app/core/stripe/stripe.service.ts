import { Injectable } from '@angular/core';
import { Appearance, Stripe, StripeElements, loadStripe } from '@stripe/stripe-js';
import { environment } from '../../../environments/environment';

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
      fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
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

/**
 * Lazy-loads Stripe.js once and exposes a thin Promise-based API for
 * mounting an Elements instance + confirming a card payment.
 */
@Injectable({ providedIn: 'root' })
export class StripeService {
  private stripe: Stripe | null = null;
  private inflight: Promise<Stripe | null> | null = null;

  async getStripe(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }
    if (!this.inflight) {
      this.inflight = loadStripe(environment.stripePublishableKey, { locale: 'hu' });
    }
    const instance = await this.inflight;
    if (!instance) {
      throw new Error('A Stripe.js betöltése sikertelen — ellenőrizd a hálózatot.');
    }
    this.stripe = instance;
    return instance;
  }

  async createElements(clientSecret: string): Promise<{ stripe: Stripe; elements: StripeElements }> {
    const stripe = await this.getStripe();
    const elements = stripe.elements({
      clientSecret,
      locale: 'hu',
      appearance: stripeAppearance(),
      fonts: [
        {
          cssSrc:
            'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
        },
      ],
    });
    return { stripe, elements };
  }
}
