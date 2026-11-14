import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeatAvailability, SeatStatus } from '../../../../shared/models/seat.model';
import { SeatGridComponent } from './seat-grid.component';

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function seat(row: number, number: number, status: SeatAvailability = 'available', over: Partial<SeatStatus> = {}): SeatStatus {
  return {
    id: `s-${row}-${number}`,
    section: 'B/1',
    row: String(row),
    number,
    category: 'standard',
    price: 2800,
    status,
    isAccessible: false,
    ...over,
  };
}

function sector(rows: number, width: number, statusOf: (r: number, n: number) => SeatAvailability = () => 'available'): SeatStatus[] {
  const out: SeatStatus[] = [];
  for (let r = 1; r <= rows; r++) for (let n = 1; n <= width; n++) out.push(seat(r, n, statusOf(r, n)));
  return out;
}

// The board animates programmatic zooms; the specs read positions straight after, so no transition.
const noMotion = document.createElement('style');
noMotion.textContent = '.kte-seat-grid__board { transition: none !important; }';
document.head.appendChild(noMotion);

/** Mounts the grid inside a box of the given width, like a phone's content column. */
function mount(width: number, seats: SeatStatus[], inputs: Record<string, unknown> = {}): ComponentFixture<SeatGridComponent> {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.appendChild(host);
  const fixture = TestBed.createComponent(SeatGridComponent);
  host.appendChild(fixture.nativeElement);
  fixture.componentRef.setInput('section', 'B/1');
  fixture.componentRef.setInput('seats', seats);
  fixture.componentRef.setInput('aisles', [14]);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture;
}

const el = (f: ComponentFixture<SeatGridComponent>): HTMLElement => f.nativeElement as HTMLElement;
const seatButton = (f: ComponentFixture<SeatGridComponent>, id: string): HTMLElement =>
  el(f).querySelector<HTMLElement>(`button[data-id="${id}"]`)!;
const boardTransform = (f: ComponentFixture<SeatGridComponent>): string =>
  el(f).querySelector<HTMLElement>('.kte-seat-grid__board')!.style.transform;
const scaleOf = (f: ComponentFixture<SeatGridComponent>): number => {
  const m = /scale\(([\d.]+)\)/.exec(boardTransform(f));
  return m ? Number(m[1]) : NaN;
};

function pointer(target: Element, type: string, pointerType = 'touch', id = 1): void {
  target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType, bubbles: true, clientX: 10, clientY: 10 }));
}

describe('SeatGridComponent', () => {
  afterEach(() => document.body.querySelectorAll('div[style*="width"]').forEach((n) => n.remove()));

  describe('layout', () => {
    it('has a dark PÁLYA strip above the rows', () => {
      const f = mount(900, sector(2, 4));
      const strip = el(f).querySelector('.kte-seat-grid__pitch')!;
      expect(text(strip)).toBe('PÁLYA');
      expect(strip.compareDocumentPosition(el(f).querySelector('.kte-seat-grid__row')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('labels the rows down the left in numeric order, not alphabetical', () => {
      const seats = [seat(10, 1), seat(2, 1), seat(1, 1), seat(16, 1), seat(9, 1)];
      const f = mount(900, seats);
      const labels = Array.from(el(f).querySelectorAll('.kte-seat-grid__row-label')).map((l) => text(l));
      expect(labels).toEqual(['1. sor', '2. sor', '9. sor', '10. sor', '16. sor']);
    });

    it('leaves a wider gap after the seats the server names as aisles, and only there', () => {
      const f = mount(900, sector(1, 28));
      const gaps = Array.from(el(f).querySelectorAll('.kte-seat--aisle')).map((b) => text(b));
      expect(gaps).toEqual(['14']);
      const a = seatButton(f, 's-1-14').getBoundingClientRect();
      const b = seatButton(f, 's-1-15').getBoundingClientRect();
      const c = seatButton(f, 's-1-13').getBoundingClientRect();
      const scale = scaleOf(f);
      // aisle gap is the seat gap plus the aisle, measured at natural size
      expect((b.left - a.right) / scale).toBeGreaterThan((a.left - c.right) / scale + 20);
    });

    it('shows the longest free run it is given, and nothing when it is not given one', () => {
      const f = mount(900, sector(1, 4), { longestRun: 9 });
      expect(text(el(f).querySelector('[data-testid="grid-longest-run"]'))).toContain('9 hely');
      f.componentRef.setInput('longestRun', null);
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="grid-longest-run"]')).toBeNull();
    });
  });

  describe('states', () => {
    const f0 = (): ComponentFixture<SeatGridComponent> => {
      const seats = [
        seat(1, 1, 'available'),
        seat(1, 2, 'available'),
        seat(1, 3, 'locked'),
        seat(1, 4, 'sold'),
        seat(1, 5, 'season_pass'),
        seat(1, 6, 'disabled'),
      ];
      return mount(900, seats, { chosenIds: new Set(['s-1-2']) });
    };

    it('tells all six states apart WITHOUT colour: each has its own glyph', () => {
      const f = f0();
      const glyphs = [1, 2, 3, 4, 5, 6].map((n) => text(seatButton(f, `s-1-${n}`)));
      expect(glyphs).toEqual(['1', '✓', '…', '×', 'B', '–']);
      expect(new Set(glyphs).size).toBe(6);
    });

    it('and each has its own texture: the border style differs where the glyph would be too small to read', () => {
      const f = f0();
      const style = (n: number): string => getComputedStyle(seatButton(f, `s-1-${n}`)).borderTopStyle;
      expect(style(3)).toBe('dashed'); // held by someone else
      expect(style(6)).toBe('dotted'); // unusable
      expect(style(1)).toBe('solid'); // free
      expect(getComputedStyle(seatButton(f, 's-1-5')).backgroundImage).toContain('repeating-linear-gradient'); // pass: stripes
      expect(getComputedStyle(seatButton(f, 's-1-2')).boxShadow).not.toBe('none'); // selected: a ring
    });

    it('the legend names every state, with the same glyph the board uses', () => {
      const f = f0();
      const items = Array.from(el(f).querySelectorAll('[data-testid="grid-legend"] li')).map((li) => text(li));
      expect(items.length).toBe(7);
      const joined = items.join(' | ');
      for (const word of ['Szabad', 'kiválasztott', 'foglalja', 'Elkelt', 'Bérletes', 'Nem használható', 'Akadálymentes']) {
        expect(joined).toContain(word);
      }
      expect(items[1].startsWith('✓')).toBeTrue();
      expect(items[3].startsWith('×')).toBeTrue();
    });

    it('gives every seat a spoken label with sector, row, seat, price and state', () => {
      const f = f0();
      expect(seatButton(f, 's-1-4').getAttribute('aria-label')).toContain('1. sor, 4. szék');
      expect(seatButton(f, 's-1-4').getAttribute('aria-label')).toContain('elkelt');
      expect(seatButton(f, 's-1-2').getAttribute('aria-pressed')).toBe('true');
      expect(seatButton(f, 's-1-1').getAttribute('aria-label')).toContain('szabad');
    });

    it('only free seats and the visitor\'s own can be acted on (others are not tab stops)', () => {
      const f = f0();
      expect(seatButton(f, 's-1-1').tabIndex).toBe(0);
      expect(seatButton(f, 's-1-2').tabIndex).toBe(0);
      for (const n of [3, 4, 5, 6]) expect(seatButton(f, `s-1-${n}`).tabIndex).toBe(-1);
    });
  });

  describe('selecting', () => {
    it('emits a free seat that is clicked, once', () => {
      const f = mount(900, sector(1, 4));
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      seatButton(f, 's-1-3').click();
      expect(picked.map((s) => s.id)).toEqual(['s-1-3']);
    });

    it('emits the visitor\'s own seat again, so it can be put back', () => {
      const f = mount(900, sector(1, 4), { chosenIds: new Set(['s-1-2']) });
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      seatButton(f, 's-1-2').click();
      expect(picked.length).toBe(1);
    });

    it('does nothing for sold, held, pass, unusable seats, and for a seat whose lock is in flight', () => {
      const seats = [seat(1, 1, 'sold'), seat(1, 2, 'locked'), seat(1, 3, 'season_pass'), seat(1, 4, 'disabled'), seat(1, 5)];
      const f = mount(900, seats, { busyIds: new Set(['s-1-5']) });
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      for (let n = 1; n <= 5; n++) seatButton(f, `s-1-${n}`).click();
      expect(picked.length).toBe(0);
    });
  });

  describe('on a 360 px phone', () => {
    // 360 px screen - 2 x 16 px page gutter - 2 x 16 px card padding - border = ~295 px window
    const PHONE = 296;

    it('starts as an overview of the whole sector (seats too small to hit)', () => {
      const f = mount(PHONE, sector(8, 28));
      expect(scaleOf(f)).toBeLessThan(0.3);
      expect(44 * scaleOf(f)).toBeLessThan(32);
    });

    it('a tap on a seat in the overview zooms in to full size on that spot instead of selecting', () => {
      const f = mount(PHONE, sector(8, 28));
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      const target = seatButton(f, 's-3-20');
      pointer(el(f).querySelector('[data-testid="grid-port"]')!, 'pointerdown');
      pointer(el(f).querySelector('[data-testid="grid-port"]')!, 'pointerup');
      target.click();
      expect(picked.length).toBe(0);
      expect(scaleOf(f)).toBe(1); // seats are 44 px now
      // and the tapped seat is on screen, not scrolled away
      const port = el(f).querySelector('[data-testid="grid-port"]')!.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(port.left - 1);
      expect(r.right).toBeLessThanOrEqual(port.right + 1);
    });

    it('once zoomed in, the next tap selects', () => {
      const f = mount(PHONE, sector(8, 28));
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      const port = el(f).querySelector('[data-testid="grid-port"]')!;
      pointer(port, 'pointerdown');
      pointer(port, 'pointerup');
      seatButton(f, 's-3-20').click(); // zooms
      pointer(port, 'pointerdown');
      pointer(port, 'pointerup');
      seatButton(f, 's-3-20').click(); // selects
      expect(picked.map((s) => s.id)).toEqual(['s-3-20']);
    });

    it('the zoom buttons are 44 px or more', () => {
      const f = mount(PHONE, sector(2, 8));
      for (const b of Array.from(el(f).querySelectorAll<HTMLElement>('.kte-seat-grid__zoom-btn'))) {
        const r = b.getBoundingClientRect();
        expect(r.width).toBeGreaterThanOrEqual(44);
        expect(r.height).toBeGreaterThanOrEqual(44);
      }
    });

    it('the + button zooms in towards the ceiling and never past it; "Teljes szektor" fits again', () => {
      const f = mount(PHONE, sector(8, 28));
      const [minus, plus, fit] = Array.from(el(f).querySelectorAll<HTMLElement>('.kte-seat-grid__zoom-btn'));
      const start = scaleOf(f);
      for (let i = 0; i < 12; i++) plus.click();
      expect(scaleOf(f)).toBe(1.25);
      minus.click();
      expect(scaleOf(f)).toBeLessThan(1.25);
      fit.click();
      expect(scaleOf(f)).toBeCloseTo(start, 3);
    });

    it('a two-finger pinch zooms and a drag pans, without selecting anything', () => {
      const f = mount(PHONE, sector(8, 28));
      const picked: SeatStatus[] = [];
      f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
      const port = el(f).querySelector('[data-testid="grid-port"]')!;
      const at = (id: number, x: number, y: number, type: string): void => {
        port.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, clientX: x, clientY: y }));
      };
      const r = port.getBoundingClientRect();
      const start = scaleOf(f);
      at(1, r.left + 100, r.top + 40, 'pointerdown');
      at(2, r.left + 140, r.top + 40, 'pointerdown');
      at(1, r.left + 60, r.top + 40, 'pointermove'); // fingers 40 px -> 120 px apart: x3
      at(2, r.left + 180, r.top + 40, 'pointermove');
      return new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          expect(scaleOf(f)).toBeCloseTo(start * 3, 3);
          at(1, r.left + 60, r.top + 40, 'pointerup');
          at(2, r.left + 180, r.top + 40, 'pointerup');
          expect(picked.length).toBe(0);
          resolve();
        }),
      );
    });
  });

  describe('wiring', () => {
    it('handles gestures even when the sector is chosen AFTER the grid was created (the real page does this)', () => {
      const host = document.createElement('div');
      host.style.width = '296px';
      document.body.appendChild(host);
      const f = TestBed.createComponent(SeatGridComponent);
      host.appendChild(f.nativeElement);
      f.componentRef.setInput('seats', []);
      f.componentRef.setInput('section', null);
      f.detectChanges(); // the placeholder: no window yet
      f.componentRef.setInput('seats', sector(8, 28));
      f.componentRef.setInput('section', 'B/1');
      f.componentRef.setInput('aisles', [14]);
      f.detectChanges();
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          const [, plus] = Array.from(el(f).querySelectorAll<HTMLElement>('.kte-seat-grid__zoom-btn'));
          for (let i = 0; i < 4; i++) plus.click(); // seats are now ~19 px: hittable with a mouse, not with a finger
          const k = scaleOf(f);
          expect(44 * k).toBeGreaterThan(18);
          expect(44 * k).toBeLessThan(32);
          const picked: SeatStatus[] = [];
          f.componentInstance.seatToggled.subscribe((s) => picked.push(s));
          // A TOUCH tap must zoom in rather than select. Only the pointer listeners know it was a touch,
          // so this fails if they were never attached to the window.
          const port = el(f).querySelector('[data-testid="grid-port"]')!;
          pointer(port, 'pointerdown', 'touch');
          pointer(port, 'pointerup', 'touch');
          seatButton(f, 's-3-20').click();
          expect(picked.length).toBe(0);
          expect(scaleOf(f)).toBe(1);
          resolve();
        }, 20),
      );
    });
  });

  describe('reveal', () => {
    it('brings the given seats into the window', () => {
      const f = mount(296, sector(8, 28));
      f.componentInstance.reveal(['s-6-22', 's-6-23', 's-6-24']);
      const port = el(f).querySelector('[data-testid="grid-port"]')!.getBoundingClientRect();
      for (const id of ['s-6-22', 's-6-24']) {
        const r = seatButton(f, id).getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(port.left - 1);
        expect(r.right).toBeLessThanOrEqual(port.right + 1);
      }
    });
  });
});
