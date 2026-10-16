import { Injectable } from '@angular/core';
import { Stripe, StripeElements, loadStripe } from '@stripe/stripe-js';
import { environment } from '../../../environments/environment';

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
      // Stripe Elements appearance values must be concrete strings — the
      // Elements iframe does not inherit the host page's CSS custom
      // properties. Keep these in sync with --kte-brand-deep,
      // --kte-surface, --kte-ink, --kte-font-body, --kte-radius-sm.
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#4A1D6A',  // --kte-brand-deep
          colorBackground: '#FFFFFF', // --kte-surface
          colorText: '#14121A',       // --kte-ink
          fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
          borderRadius: '8px',        // --kte-radius-sm
        },
      },
    });
    return { stripe, elements };
  }
}
