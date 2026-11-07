import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatchWeatherForecast } from '../../../shared/models/payment.model';
import { WeatherBannerComponent } from './weather-banner.component';

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
  fallback: false,
};

const noForecast = (
  reason: MatchWeatherForecast['unavailableReason'],
): MatchWeatherForecast => ({
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

  function render(forecast: MatchWeatherForecast | null, sections: string[] = ['B']): void {
    fixture.componentRef.setInput('forecast', forecast);
    fixture.componentRef.setInput('sectionsInCart', sections);
    fixture.detectChanges();
  }
  const warning = () => el.querySelector('.kte-weather');
  const note = () => el.querySelector('[data-testid="weather-no-forecast"]');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WeatherBannerComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(WeatherBannerComponent);
    el = fixture.nativeElement;
  });

  it('shows the rain warning for a real forecast with an uncovered sector', () => {
    render(available);
    expect(warning()).not.toBeNull();
    expect(warning()!.textContent).toContain('Gyenge eső');
    expect(note()).toBeNull();
  });

  it('beyond the forecast range: a calm "not available yet" note, never a rain warning', () => {
    render(noForecast('too_far'));
    expect(warning()).toBeNull();
    expect(note()!.textContent).toContain('még nem elérhető');
    expect(note()!.textContent).toContain('túl messze');
    // No numbers are rendered for a forecast that does not exist.
    expect(el.textContent).not.toMatch(/mm\/h|%/);
  });

  it('provider outage: says the forecast is currently unavailable', () => {
    render(noForecast('no_data'));
    expect(note()!.textContent).toContain('jelenleg nem elérhető');
  });

  it('already-started match or no forecast object: renders nothing', () => {
    render(noForecast('past'));
    expect(warning()).toBeNull();
    expect(note()).toBeNull();
    render(null);
    expect(el.textContent!.trim()).toBe('');
  });

  it('a real forecast without rain shows nothing', () => {
    render({ ...available, rainWarning: false });
    expect(warning()).toBeNull();
    expect(note()).toBeNull();
  });
});
