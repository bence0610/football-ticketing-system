import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'kte-not-found-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <section class="kte-404">
      <div class="kte-404__code">404</div>
      <h1>Az oldal nem található</h1>
      <p>A keresett tartalom időközben elköltözött, vagy soha nem létezett.</p>
      <a mat-flat-button color="primary" routerLink="/">
        <mat-icon>home</mat-icon>
        Vissza a kezdőlapra
      </a>
    </section>
  `,
  styles: [
    `
      .kte-404 {
        text-align: center;
        padding: 64px 24px;
        max-width: 540px;
        margin: 0 auto;
      }

      .kte-404__code {
        font-size: 96px;
        font-weight: 700;
        color: var(--kte-color-primary);
        line-height: 1;
        margin-bottom: 16px;
      }

      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }

      p {
        margin: 0 0 24px;
        color: var(--kte-muted);
      }
    `,
  ],
})
export class NotFoundPageComponent {}
