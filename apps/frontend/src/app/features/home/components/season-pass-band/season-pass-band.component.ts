import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'kte-season-pass-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule],
  template: `
    <section class="band" aria-labelledby="pass-title">
      <div class="band__inner">
        <div class="band__text">
          <h2 id="pass-title">Egy hely az egész szezonra</h2>
          <p>
            A bérlettel a saját széked az egész szezonra a tiéd. Ha egy meccsen nem tudsz ott lenni,
            kölcsönadhatod a helyedet egy másik szurkolónak arra az egy mérkőzésre – így a szék
            sosem marad üresen.
          </p>
        </div>
        <a mat-flat-button color="primary" class="band__cta" routerLink="/season-pass">
          Bérletek megtekintése
        </a>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .band {
        background: var(--surface);
        border-top: 1px solid var(--border);
      }

      .band__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 56px 32px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px 48px;
        flex-wrap: wrap;
      }

      .band__text {
        flex: 1 1 420px;
        min-width: 0;
      }

      .band__cta {
        flex: 0 0 auto;
      }

      h2 {
        margin: 0 0 12px;
      }

      p {
        margin: 0;
        max-width: 62ch;
        color: var(--muted);
      }

      @media (max-width: 599px) {
        .band__inner {
          padding: 40px 16px;
        }
        .band__cta {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class SeasonPassBandComponent {}
