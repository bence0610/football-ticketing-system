import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { SectorSummary } from '../../../shared/models/seat.model';
import { SeatsApiService } from '../../../shared/services/seats.api.service';
import { MatchPricesService } from './match-prices.service';

const sector = (section: string, minPrice: number, over: Partial<SectorSummary> = {}): SectorSummary => ({
  section,
  name: `${section} szektor`,
  arc: 'lower',
  position: 1,
  gate: 2,
  priceCategory: 'lower',
  isAway: false,
  covered: false,
  total: 100,
  available: 50,
  locked: 0,
  sold: 50,
  occupancyRatio: 0.5,
  minPrice,
  maxPrice: minPrice,
  ...over,
});

/**
 * Every "cheapest sector" and "from price" in the UI (the home hero and cards,
 * the loyalty example, the cart suggestion) reads this list. The away section is
 * not for sale, so it must never be in it, however cheap it is.
 */
describe('MatchPricesService', () => {
  function service(sectors: SectorSummary[]): MatchPricesService {
    TestBed.configureTestingModule({
      providers: [
        { provide: SeatsApiService, useValue: { loadSeats: () => of({ matchId: 'm', seats: [], sectorSummary: sectors }) } },
      ],
    });
    return TestBed.inject(MatchPricesService);
  }

  it('lists sectors cheapest first', async () => {
    const res = await firstValueFrom(service([sector('K', 3500), sector('M', 2800), sector('J', 5250)]).forMatch('m'));
    expect(res.sectors.map((s) => s.section)).toEqual(['M', 'K', 'J']);
    expect(res.lowest).toBe(2800);
  });

  it('never offers the away section, even when it is the cheapest', async () => {
    const res = await firstValueFrom(
      service([sector('K', 3500), sector('VENDÉG', 1000, { isAway: true, available: 0 })]).forMatch('m'),
    );
    expect(res.sectors.map((s) => s.section)).toEqual(['K']);
    // the "from" price is not set by a section nobody can buy
    expect(res.lowest).toBe(3500);
    expect(res.sectors[0]).toBe(res.sectors.find((s) => !s.isAway)!);
  });

  it('has no price at all when only the away section is left', async () => {
    const res = await firstValueFrom(service([sector('VENDÉG', 1000, { isAway: true })]).forMatch('m'));
    expect(res.sectors).toEqual([]);
    expect(res.lowest).toBeNull();
  });
});
