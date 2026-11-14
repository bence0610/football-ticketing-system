import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { CartFacade } from '../../../../core/cart/cart.facade';
import { BestSeatsRequest, BestSeatsResponse, SeatStatus } from '../../../../shared/models/seat.model';
import { SeatsApiService } from '../../../../shared/services/seats.api.service';
import { BestSeatsPanelComponent, BestSeatsPlaced } from './best-seats-panel.component';

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const seat = (n: number, row = '3'): SeatStatus => ({
  id: `s-${row}-${n}`,
  section: 'C/2',
  row,
  number: n,
  category: 'standard',
  price: 2800,
  status: 'locked',
  isAccessible: false,
});

const response = (runs: SeatStatus[][], kind: 'together' | 'split' = 'together'): BestSeatsResponse => ({
  matchId: 'm1',
  section: 'C/2',
  kind,
  runs: runs.map((seats) => ({ row: seats[0].row, seats })),
  ownerToken: 'tok',
  ttlSeconds: 300,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});

const conflict = (body: object): HttpErrorResponse => new HttpErrorResponse({ status: 409, error: { statusCode: 409, ...body } });

describe('BestSeatsPanelComponent', () => {
  let calls: BestSeatsRequest[];
  let reply: () => Observable<BestSeatsResponse>;
  let cartItems: ReturnType<typeof signal<readonly unknown[]>>;
  let added: Array<{ seats: readonly SeatStatus[]; lock: { ownerToken: string; ttlSeconds: number } }>;

  function make(over: { longestRun?: number } = {}): ComponentFixture<BestSeatsPanelComponent> {
    calls = [];
    added = [];
    cartItems = signal<readonly unknown[]>([]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SeatsApiService,
          useValue: {
            findBestSeats: (_m: string, req: BestSeatsRequest) => {
              calls.push(req);
              return reply();
            },
          },
        },
        {
          provide: CartFacade,
          useValue: {
            items: cartItems,
            addLocked: (seats: readonly SeatStatus[], lock: { ownerToken: string; ttlSeconds: number }) => {
              added.push({ seats, lock });
              return [];
            },
          },
        },
      ],
    });
    const f = TestBed.createComponent(BestSeatsPanelComponent);
    f.componentRef.setInput('section', 'C/2');
    f.componentRef.setInput('sectorName', 'C/2 szektor');
    f.componentRef.setInput('longestRun', over.longestRun ?? 9);
    f.componentRef.setInput('match', { id: 'm1', homeTeam: 'KTE', awayTeam: 'X', kickoffAt: new Date().toISOString() });
    f.detectChanges();
    return f;
  }
  const el = (f: ComponentFixture<unknown>): HTMLElement => f.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(f: ComponentFixture<unknown>, id: string): T => el(f).querySelector(`[data-testid="${id}"]`) as T;
  const flush = async (f: ComponentFixture<unknown>): Promise<void> => {
    await f.whenStable();
    f.detectChanges();
  };

  it("shows the sector's longest free run", () => {
    const f = make({ longestRun: 9 });
    expect(text(q(f, 'finder-longest-run'))).toContain('9 hely');
  });

  it('says plainly that there is nothing to find when the sector is full, and does not offer the search', () => {
    const f = make({ longestRun: 0 });
    expect(text(q(f, 'finder-longest-run'))).toContain('nincs szabad hely');
    expect(q<HTMLButtonElement>(f, 'finder-go').disabled).toBeTrue();
  });

  it('counts the party from 1 to 6, no further', () => {
    const f = make();
    const [minus, plus] = Array.from(el(f).querySelectorAll<HTMLButtonElement>('.kte-finder__stepper button'));
    for (let i = 0; i < 10; i++) plus.click();
    f.detectChanges();
    expect(text(q(f, 'finder-count'))).toBe('6');
    for (let i = 0; i < 10; i++) minus.click();
    f.detectChanges();
    expect(text(q(f, 'finder-count'))).toBe('1');
  });

  it('asks the server for that many in this sector, without a split, and puts the answer in the cart', async () => {
    const f = make();
    const placed: BestSeatsPlaced[] = [];
    f.componentInstance.placed.subscribe((p) => placed.push(p));
    reply = () => of(response([[seat(5), seat(6)]]));
    q<HTMLButtonElement>(f, 'finder-go').click();
    await flush(f);

    expect(calls).toEqual([{ section: 'C/2', count: 2, allowSplit: false }]);
    expect(added.length).toBe(1);
    expect(added[0].seats.map((s) => s.number)).toEqual([5, 6]);
    expect(added[0].lock).toEqual({ ownerToken: 'tok', ttlSeconds: 300 });
    expect(placed.length).toBe(1);
    expect(text(q(f, 'finder-result'))).toContain('Lefoglaltunk 2 helyet egymás mellett: 3. sor 5–6. szék');
  });

  it('when no run is long enough it says so, names the longest run, and offers the two shorter runs', async () => {
    const f = make();
    reply = () =>
      throwError(() =>
        conflict({
          code: 'no_adjacent_run',
          message: 'x',
          requested: 4,
          longestRun: 3,
          freeSeats: 20,
          alternative: {
            runs: [
              { row: '3', firstNumber: 5, lastNumber: 6, length: 2 },
              { row: '7', firstNumber: 2, lastNumber: 3, length: 2 },
            ],
          },
        }),
      );
    const [, plus] = Array.from(el(f).querySelectorAll<HTMLButtonElement>('.kte-finder__stepper button'));
    plus.click();
    plus.click();
    f.detectChanges();
    q<HTMLButtonElement>(f, 'finder-go').click();
    await flush(f);

    expect(text(q(f, 'finder-refusal'))).toContain('Nincs 4 egymás melletti szabad hely');
    expect(text(q(f, 'finder-refusal'))).toContain('leghosszabb szabad sor 3 hely');
    expect(text(q(f, 'finder-accept-split'))).toContain('3. sor 5–6. szék és 7. sor 2–3. szék');
    expect(added.length).toBe(0); // nothing was taken without being asked

    // accepting asks again, this time allowing the split, and takes it
    reply = () => of(response([[seat(5), seat(6)], [seat(2, '7'), seat(3, '7')]], 'split'));
    q<HTMLButtonElement>(f, 'finder-accept-split').click();
    await flush(f);
    expect(calls[1]).toEqual({ section: 'C/2', count: 4, allowSplit: true });
    expect(added[0].seats.length).toBe(4);
    expect(text(q(f, 'finder-result'))).toContain('két külön helyen');
  });

  it('when even a split is impossible it says that, and offers nothing it cannot deliver', async () => {
    const f = make();
    reply = () => throwError(() => conflict({ code: 'no_adjacent_run', message: 'x', longestRun: 2, freeSeats: 6, alternative: null }));
    q<HTMLButtonElement>(f, 'finder-go').click();
    await flush(f);
    expect(text(q(f, 'finder-refusal'))).toContain('Két külön sorba sem tudjuk elosztani');
    expect(q(f, 'finder-accept-split')).toBeNull();
  });

  it('says how many seats are left when the sector cannot seat the party at all', async () => {
    const f = make();
    reply = () => throwError(() => conflict({ code: 'not_enough_seats', message: 'x', freeSeats: 1 }));
    q<HTMLButtonElement>(f, 'finder-go').click();
    await flush(f);
    expect(text(q(f, 'finder-refusal'))).toContain('már csak 1 szabad hely van');
    expect(q(f, 'finder-accept-split')).toBeNull();
  });

  it('keeps a party within what the cart can still take', async () => {
    const f = make();
    cartItems.set([1, 2, 3, 4]); // 4 of 6 used
    f.detectChanges();
    const [, plus] = Array.from(el(f).querySelectorAll<HTMLButtonElement>('.kte-finder__stepper button'));
    for (let i = 0; i < 5; i++) plus.click();
    f.detectChanges();
    expect(text(q(f, 'finder-count'))).toBe('2');
    reply = () => of(response([[seat(5), seat(6)]]));
    q<HTMLButtonElement>(f, 'finder-go').click();
    await flush(f);
    expect(calls[0].count).toBe(2);
  });
});
