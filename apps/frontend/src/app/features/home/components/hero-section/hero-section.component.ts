import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'kte-hero-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <section class="kte-hero" aria-labelledby="kte-hero-title">
      <div class="kte-hero__crest" aria-hidden="true">
        <span class="kte-hero__crest-mark">KTE</span>
      </div>

      <div class="kte-hero__content">
        <span class="kte-hero__eyebrow">Kecskeméti TE — Hivatalos jegyportál</span>
        <h1 id="kte-hero-title">Élj át minden gólt&nbsp;a&nbsp;Széktóiban.</h1>
        <p class="kte-hero__lead">
          NB1 hazai mérkőzések, bérletek és hűségpontok egy helyen. Foglald le a helyed
          valós idejű ülésrenden, és vidd magaddal a digitális jegyed.
        </p>

        <div class="kte-hero__cta">
          <a mat-flat-button color="accent" routerLink="/stadium" class="kte-hero__primary-cta">
            <mat-icon>event_seat</mat-icon>
            Jegyvásárlás
          </a>
          <a mat-stroked-button color="accent" routerLink="/profile" class="kte-hero__secondary-cta">
            <mat-icon>card_membership</mat-icon>
            Bérletek
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-hero {
        position: relative;
        display: grid;
        grid-template-columns: minmax(160px, 240px) 1fr;
        align-items: center;
        gap: 32px;
        padding: 56px 48px;
        border-radius: var(--kte-radius-lg);
        background:
          radial-gradient(circle at 85% 20%, rgba(243, 237, 248, 0.18), transparent 60%),
          linear-gradient(135deg, var(--kte-brand-deep) 0%, var(--kte-ink) 100%);
        color: var(--kte-surface);
        overflow: hidden;
        box-shadow: var(--kte-shadow-md);
      }

      .kte-hero::after {
        content: '';
        position: absolute;
        inset: auto -40px -40px auto;
        width: 320px;
        height: 320px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(243, 237, 248, 0.12), transparent 70%);
        pointer-events: none;
      }

      .kte-hero__crest {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 200px;
        height: 200px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.05);
        border: 4px solid var(--kte-brand-tint);
        box-shadow: 0 12px 36px rgba(20, 18, 26, 0.32);
      }

      .kte-hero__crest-mark {
        font-family: var(--kte-font-display);
        font-weight: 800;
        font-size: 64px;
        letter-spacing: 0.04em;
        color: var(--kte-brand-tint);
      }

      .kte-hero__content {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: 640px;
        position: relative;
        z-index: 1;
      }

      .kte-hero__eyebrow {
        font-size: 13px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--kte-brand-tint);
        font-weight: 600;
      }

      h1 {
        margin: 0;
        font-family: var(--kte-font-display);
        font-weight: 800;
        font-size: clamp(36px, 5vw, 56px);
        line-height: 1.05;
        letter-spacing: -0.01em;
      }

      .kte-hero__lead {
        margin: 0;
        font-size: 17px;
        line-height: 1.55;
        color: rgba(255, 255, 255, 0.85);
      }

      .kte-hero__cta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }

      .kte-hero__primary-cta {
        font-weight: 700;
        height: 48px;
        padding: 0 24px;
      }

      .kte-hero__secondary-cta {
        height: 48px;
        padding: 0 24px;
        color: var(--kte-brand-tint);
        border-color: var(--kte-brand-tint) !important;
      }

      @media (max-width: 720px) {
        .kte-hero {
          grid-template-columns: 1fr;
          padding: 36px 24px;
          text-align: center;
        }

        .kte-hero__crest {
          margin: 0 auto;
          width: 140px;
          height: 140px;
        }

        .kte-hero__crest-mark {
          font-size: 44px;
        }

        .kte-hero__cta {
          justify-content: center;
        }
      }
    `,
  ],
})
export class HeroSectionComponent {}
