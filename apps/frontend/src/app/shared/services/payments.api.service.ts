import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ConfirmPaymentResponse,
  CreatePaymentIntentRequest,
  MatchWeatherForecast,
  PaymentIntentResponse,
} from '../models/payment.model';

@Injectable({ providedIn: 'root' })
export class PaymentsApiService {
  private readonly http = inject(HttpClient);

  createIntent(payload: CreatePaymentIntentRequest): Observable<PaymentIntentResponse> {
    return this.http.post<PaymentIntentResponse>('/payments/create-intent', payload, {
      withCredentials: true,
    });
  }

  /**
   * Frontend-driven fallback for the Stripe webhook: after `stripe.confirmPayment()`
   * resolves with a successful PaymentIntent, the checkout page hits this
   * endpoint so tickets are created even if the webhook is delayed (typical
   * with the local Stripe CLI listener). The backend re-fetches the
   * PaymentIntent from Stripe, verifies success, and idempotently creates
   * Ticket rows + awards loyalty.
   */
  confirmPayment(paymentIntentId: string): Observable<ConfirmPaymentResponse> {
    return this.http.post<ConfirmPaymentResponse>(
      '/payments/confirm',
      { paymentIntentId },
      { withCredentials: true },
    );
  }

  weatherForMatch(matchId: string): Observable<MatchWeatherForecast> {
    return this.http.get<MatchWeatherForecast>(`/weather/match/${matchId}`);
  }
}
