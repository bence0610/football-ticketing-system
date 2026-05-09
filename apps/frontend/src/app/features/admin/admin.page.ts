import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'kte-admin-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <section class="kte-admin">
      <header class="kte-admin__header">
        <div>
          <h1>Admin felület</h1>
          <p>Operatív kontroll panel - csak adminisztrátoroknak.</p>
        </div>
      </header>

      <nav class="kte-admin__nav">
        <a
          mat-stroked-button
          routerLink="revenue"
          [routerLinkActive]="'kte-admin__nav-active'"
        >
          <mat-icon>monetization_on</mat-icon>
          Bevételi statisztikák
        </a>
        <a
          mat-stroked-button
          routerLink="heatmap"
          [routerLinkActive]="'kte-admin__nav-active'"
        >
          <mat-icon>map</mat-icon>
          Foglaltsági heatmap
        </a>
      </nav>

      <div class="kte-admin__content">
        <router-outlet />
      </div>
    </section>
  `,
  styles: [
    `
      .kte-admin {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 24px;
        max-width: 1280px;
        margin: 0 auto;
      }
      .kte-admin__header h1 {
        margin: 0 0 4px;
        color: #C94B1E;
      }
      .kte-admin__header p {
        margin: 0;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-admin__nav {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .kte-admin__nav a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .kte-admin__nav-active {
        background: rgba(201, 75, 30, 0.12);
        color: #C94B1E;
        font-weight: 600;
      }
      .kte-admin__content {
        background: #FAFAFA;
        border-radius: 12px;
        padding: 8px;
        min-height: 400px;
      }
    `,
  ],
})
export class AdminPageComponent {}
