import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatchWeatherForecast } from '../../../shared/models/payment.model';
import { WeatherBannerComponent, weatherIcon } from './weather-banner.component';

const available: MatchWeatherForecast = {
  matchId: 'm1',
  city: 'Kecskemet,HU',
  forecastFor: '2030-01-01T17:00:00Z',
  summary: 'Gyenge eső',
  temperatureCelsius: 9,
  precipitationMmPerHour: 1.2,
  precipitationProbability: 0.65,
  windSpeedMs: 3,
  rainWarning: true,
  icon: '10d',
  fallback: false,
};

const noForecast = (reason: MatchWeatherForecast['unavailableReason']): MatchWeatherForecast => ({
  matchId: 'm1',
  city: 'Kecskemet,HU',
  forecastFor: '2030-01-01T17:00:00Z',
  summary: 'Az előrejelzés még nem elérhető',
  temperatureCelsius: null,
  precipitationMmPerHour: null,
  precipitationProbability: null,
  windSpeedMs: null,
  rainWarning: false,
  fallback: true,
  unavailableReason: reason,
});

describe('WeatherBannerComponent', () => {
  let fixture: ComponentFixture<WeatherBannerComponent>;
  let el: HTMLElement;

  function render(
    forecast: MatchWeatherForecast | null,
    sections: string[] = ['B'],
    coverage: Record<string, boolean | null> = { A: false, B: true, C: false, VIP: true },
  ): void {
    fixture.componentRef.setInput('forecast', forecast);
    fixture.componentRef.setInput('sectionsInCart', sections);
    fixture.componentRef.setInput('coverage', coverage);
    fixture.detectChanges();
  }
  const band = () => el.querySelector('[data-testid="weather-band"]');
  const cover = () => el.querySelector('[data-testid="weather-cover"]')?.textContent ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WeatherBannerComponent] });
    fixture = TestBed.createComponent(WeatherBannerComponent);
    el = fixture.nativeElement;
  });

  it('shows the kickoff forecast with only the values it really has', () => {
    render(available);
    expect(band()!.textContent).toContain('Kezdéskor: gyenge eső · 9 °C · 65% csapadékvalószínűség');
  });

  it('leaves out values the forecast does not have', () => {
    render({ ...available, temperatureCelsius: null, precipitationProbability: null });
    expect(band()!.textContent).toContain('Kezdéskor: gyenge eső');
    expect(band()!.textContent).not.toContain('°C');
    expect(band()!.textContent).not.toContain('%');
  });

  describe('the coverage claim follows the flag', () => {
    it('says covered for a covered sector and not covered for an open one (VIP and B covered, A and C open)', () => {
      render(available, ['B']);
      expect(cover()).toContain('(B szektor) fedett');
      render(available, ['VIP']);
      expect(cover()).toContain('(VIP) fedett');
      render(available, ['A']);
      expect(cover()).toContain('(A szektor) nem fedett');
      render(available, ['C']);
      expect(cover()).toContain('(C szektor) nem fedett');
    });

    it('flipping the flag flips the claim - nothing is hard-coded to a sector name', () => {
      // VIP was once the only covered sector in the code; with the flag it is just data
      render(available, ['VIP'], { VIP: true });
      expect(cover()).toContain('fedett');
      expect(cover()).not.toContain('nem fedett');

      render(available, ['VIP'], { VIP: false });
      expect(cover()).toContain('(VIP) nem fedett');

      // and a sector that used to be "open" becomes covered when the data says so
      render(available, ['A'], { A: true });
      expect(cover()).toContain('(A szektor) fedett');
      expect(cover()).not.toContain('nem fedett');
    });

    it('says nothing about a sector the server has no flag for - it is never assumed open', () => {
      render(available, ['VIP'], {});
      expect(cover()).toBe('');
      render(available, ['VIP'], { VIP: null });
      expect(cover()).toBe('');
      // the forecast itself is still shown
      expect(band()!.textContent).toContain('Kezdéskor:');
    });

    it('with data for only some of the sectors, claims only what it knows', () => {
      render(available, ['A', 'B'], { B: true });
      expect(cover()).toContain('(B szektor) fedett');
      expect(cover()).not.toContain('nem fedett');
      expect(cover()).not.toContain('A szektor');
    });

    it('does not tell a dry forecast to expect rain', () => {
      render({ ...available, rainWarning: false, summary: 'Derült ég' }, ['A']);
      expect(cover()).toContain('nem fedett');
      expect(cover()).not.toContain('esőre');
    });

    it('warns an open sector about the rain, but only for a rain forecast', () => {
      render(available, ['A']);
      expect(cover()).toContain('esőre számíts');
    });

    it('handles a mixed cart from the flags', () => {
      render(available, ['A', 'VIP']);
      expect(cover()).toContain('Fedett: VIP');
      expect(cover()).toContain('nem fedett: A szektor');
    });
  });

  it('renders nothing - not an empty band - without a real forecast', () => {
    for (const forecast of [null, noForecast('too_far'), noForecast('no_data'), noForecast('past'), noForecast(undefined)]) {
      render(forecast);
      expect(band()).toBeNull();
      expect(el.textContent?.trim()).toBe('');
    }
  });

  it('picks an icon from the weather code', () => {
    expect(weatherIcon('01d')).toBe('wb_sunny');
    expect(weatherIcon('10n')).toBe('umbrella');
    expect(weatherIcon('13d')).toBe('ac_unit');
    expect(weatherIcon(undefined)).toBe('cloud');
  });
});
