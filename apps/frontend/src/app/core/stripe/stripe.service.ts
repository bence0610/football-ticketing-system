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
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#0a3d62',
          colorBackground: '#ffffff',
          colorText: '#1a1a1a',
          fontFamily: 'Inter, sans-serif',
          borderRadius: '8px',
        },
      },
    });
    return { stripe, elements };
  }
}
