import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { WaitlistEntry } from '../../../../shared/models/waitlist.model';
import { WaitlistApiService } from '../../../../shared/services/waitlist.api.service';
import { extractApiErrorMessage } from '../../../../shared/utils/api-error';

/**
 * Floating "Join waitlist" button shown on a sold-out match panel. The
 * button is hidden when the user is not signed in (Snackbar-redirects them
 * to /login on click) — and disabled while the join request is in flight.
 *
 * On success it emits `(joined)` so the parent can refresh local state if
 * needed (e.g. show "Waitlist position #3").
 */
@Component({
  selector: 'kte-waitlist-join-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <button
      mat-flat-button
      color="primary"
      type="button"
      class="kte-waitlist-join"
      [disabled]="loading()"
      (click)="onClick()"
    >
      @if (loading()) {
        <mat-spinner diameter="18" />
        Csatlakozás…
      } @else {
        <mat-icon>queue</mat-icon>
        Várólistára iratkozom
      }
    </button>
  `,
  styles: [
    `
      .kte-waitlist-join {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
    `,
  ],
})
export class WaitlistJoinButtonComponent {
  @Input({ required: true }) matchId!: string;
  @Input() requestedQuantity = 1;
  @Input() preferredSection?: string;

  @Output() readonly joined = new EventEmitter<WaitlistEntry>();

  private readonly api = inject(WaitlistApiService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);

  protected async onClick(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      this.snackBar.open(
        'Várólistára csak bejelentkezett felhasználók iratkozhatnak fel.',
        'Bejelentkezés',
        { duration: 5000 },
      );
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: this.router.url },
      });
      return;
    }
    this.loading.set(true);
    try {
      const entry = await firstValueFrom(
        this.api.join({
          matchId: this.matchId,
          requestedQuantity: this.requestedQuantity,
          preferredSection: this.preferredSection,
        }),
      );
      this.joined.emit(entry);
      this.snackBar.open(
        `Sikeresen feliratkoztál a várólistára (${entry.position}. pozíció).`,
        'Bezárás',
        { duration: 5000 },
      );
    } catch (error) {
      const message = this.normalizeError(error);
      this.snackBar.open(message, 'Bezárás', { duration: 6000 });
    } finally {
      this.loading.set(false);
    }
  }

  private normalizeError(error: unknown): string {
    return extractApiErrorMessage(error, 'A várólistára történő feliratkozás sikertelen.');
  }
}
