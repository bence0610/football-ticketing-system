import { TestBed } from '@angular/core/testing';
import { SeatStatus } from '../../../../shared/models/seat.model';
import { SeatGridComponent } from './seat-grid.component';

/**
 * Measures the largest sector (448 seats: 16 rows x 28) in real Chrome (Karma,
 * ChromeHeadless). It prints PERF lines; the assertions are only generous ceilings
 * so a regression to the old behaviour (see the numbers in docs) would show.
 *
 * "render" = createComponent + first detectChanges + forced layout, i.e. what the
 * visitor waits for after picking a sector. "interaction" = the work between a tap
 * and the frame that shows it (input change, change detection, forced layout).
 * "refresh" = the seat list replaced by a fresh copy with a few statuses changed,
 * as happens when the seat map reloads. "pan frame" = one pointermove through the
 * transform write, forced to layout.
 */
function sector448(): SeatStatus[] {
  const out: SeatStatus[] = [];
  for (let r = 1; r <= 16; r++) {
    for (let n = 1; n <= 28; n++) {
      out.push({
        id: `s-${r}-${n}`,
        section: 'B/1',
        row: String(r),
        number: n,
        category: 'standard',
        price: 2800,
        status: (r * 31 + n * 7) % 5 === 0 ? 'sold' : (r + n) % 11 === 0 ? 'locked' : 'available',
        isAccessible: r === 1 && n < 3,
      });
    }
  }
  return out;
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

describe('SeatGridComponent performance, 448 seats', () => {
  it('renders and reacts fast enough', async () => {
    const seats = sector448();
    const first: number[] = [];
    for (let i = 0; i < 8; i++) {
      const host = document.createElement('div');
      host.style.width = '900px';
      document.body.appendChild(host);
      const f = TestBed.createComponent(SeatGridComponent);
      host.appendChild(f.nativeElement);
      const t0 = performance.now();
      f.componentRef.setInput('seats', seats);
      f.componentRef.setInput('section', 'B/1');
      f.componentRef.setInput('aisles', [14]);
      f.detectChanges();
      void (f.nativeElement as HTMLElement).offsetHeight;
      first.push(performance.now() - t0);

      if (i < 7) {
        f.destroy();
        host.remove();
        continue;
      }

      // interaction: toggle a seat (a new chosenIds set each time, as the page does)
      const free = seats.filter((s) => s.status === 'available');
      const chosen = new Set<string>();
      const toggle: number[] = [];
      for (let k = 0; k < 40; k++) {
        const t1 = performance.now();
        chosen.has(free[k].id) ? chosen.delete(free[k].id) : chosen.add(free[k].id);
        f.componentRef.setInput('chosenIds', new Set(chosen));
        f.detectChanges();
        void (f.nativeElement as HTMLElement).offsetHeight;
        toggle.push(performance.now() - t1);
      }

      // refresh: a new array of the same seats, a handful of statuses changed
      const refresh: number[] = [];
      for (let k = 0; k < 20; k++) {
        const next = seats.map((s, idx) => (idx % 97 === k ? { ...s, status: 'locked' as const } : s));
        const t2 = performance.now();
        f.componentRef.setInput('seats', next);
        f.detectChanges();
        void (f.nativeElement as HTMLElement).offsetHeight;
        refresh.push(performance.now() - t2);
      }

      // pan: 60 pointer moves of one finger, each followed by the frame that paints it
      const port = (f.nativeElement as HTMLElement).querySelector('[data-testid="grid-port"]')!;
      (f.nativeElement as HTMLElement).querySelector<HTMLElement>('.kte-seat-grid__zoom-btn:nth-child(2)')!.click();
      const r = port.getBoundingClientRect();
      port.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', bubbles: true, clientX: r.left + 200, clientY: r.top + 100 }));
      const pan: number[] = [];
      for (let k = 1; k <= 60; k++) {
        const t3 = performance.now();
        port.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', bubbles: true, clientX: r.left + 200 - k * 4, clientY: r.top + 100 - k }));
        await nextFrame();
        pan.push(performance.now() - t3);
      }
      port.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true }));

      const el = f.nativeElement as HTMLElement;
      console.log(
        `PERF new buttons=${el.querySelectorAll('button[data-id]').length} domNodes=${el.querySelectorAll('*').length} ` +
          `render first=${first[0].toFixed(1)}ms warm-median=${median(first.slice(1)).toFixed(1)}ms | ` +
          `interaction median=${median(toggle).toFixed(1)}ms p95=${p95(toggle).toFixed(1)}ms | ` +
          `refresh median=${median(refresh).toFixed(1)}ms p95=${p95(refresh).toFixed(1)}ms | ` +
          `pan frame median=${median(pan).toFixed(1)}ms p95=${p95(pan).toFixed(1)}ms (rAF-bound, ~16.7 = 60 fps)`,
      );
      expect(median(toggle)).toBeLessThan(33);
      expect(median(first.slice(1))).toBeLessThan(300);
      f.destroy();
      host.remove();
    }
  });
});
