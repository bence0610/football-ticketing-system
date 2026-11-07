import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { LoyaltyService } from './loyalty.service';

describe('LoyaltyService.recordTierAndDetectUpgrade', () => {
  let service: LoyaltyService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LoyaltyService);
  });

  afterEach(() => localStorage.clear());

  it('the first load only records a baseline — nobody is congratulated for their current tier', () => {
    expect(service.recordTierAndDetectUpgrade('u1', 'silver')).toBeNull();
  });

  it('an unchanged tier on the next visit is not an upgrade', () => {
    service.recordTierAndDetectUpgrade('u1', 'bronze');
    expect(service.recordTierAndDetectUpgrade('u1', 'bronze')).toBeNull();
  });

  it('a higher tier than the last visit is an upgrade, reported once', () => {
    service.recordTierAndDetectUpgrade('u1', 'bronze');
    expect(service.recordTierAndDetectUpgrade('u1', 'silver')).toBe('silver');
    expect(service.recordTierAndDetectUpgrade('u1', 'silver')).toBeNull();
  });

  it('skipping a tier still counts as an upgrade to the tier actually reached', () => {
    service.recordTierAndDetectUpgrade('u1', 'bronze');
    expect(service.recordTierAndDetectUpgrade('u1', 'gold')).toBe('gold');
  });

  it('a lower tier is recorded silently and is not congratulated', () => {
    service.recordTierAndDetectUpgrade('u1', 'gold');
    expect(service.recordTierAndDetectUpgrade('u1', 'silver')).toBeNull();
    expect(service.recordTierAndDetectUpgrade('u1', 'gold')).toBe('gold');
  });

  it('keeps each user separate on a shared browser', () => {
    service.recordTierAndDetectUpgrade('u1', 'gold');
    expect(service.recordTierAndDetectUpgrade('u2', 'bronze')).toBeNull();
    expect(service.recordTierAndDetectUpgrade('u1', 'platinum')).toBe('platinum');
  });

  it('survives a new service instance (a new page visit)', () => {
    service.recordTierAndDetectUpgrade('u1', 'bronze');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    expect(TestBed.inject(LoyaltyService).recordTierAndDetectUpgrade('u1', 'silver')).toBe('silver');
  });

  it('with storage unavailable it stays silent instead of throwing', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('denied');
    expect(service.recordTierAndDetectUpgrade('u1', 'silver')).toBeNull();
  });
});
