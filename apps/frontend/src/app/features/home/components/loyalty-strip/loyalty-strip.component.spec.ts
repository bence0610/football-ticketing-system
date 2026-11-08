import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoyaltySnapshotResponse, LoyaltyTier } from '../../../../core/models/loyalty.models';
import { LoyaltyStripComponent } from './loyalty-strip.component';

type Rgb = [number, number, number];

function parse(color: string): Rgb {
  const m = color.match(/\d+(\.\d+)?/g) ?? [];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const LABELS: Record<LoyaltyTier, string> = {
  bronze: 'Kék',
  silver: 'Ezüst',
  gold: 'Arany',
  platinum: 'KTE Legenda',
};
const ORDER: LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];
const FLOORS = [0, 500, 1500, 5000];

function snapshot(tier: LoyaltyTier, points: number): LoyaltySnapshotResponse {
  const i = ORDER.indexOf(tier);
  const make = (idx: number) => ({
    tier: ORDER[idx],
    label: LABELS[ORDER[idx]],
    minPoints: FLOORS[idx],
    discountPercent: idx * 5,
    color: '#000000',
  });
  const next = ORDER[i + 1] ? make(i + 1) : undefined;
  return {
    points,
    tier: make(i),
    nextTier: next,
    pointsToNextTier: next ? next.minPoints - points : undefined,
    recentTransactions: [],
  };
}

describe('LoyaltyStripComponent', () => {
  let fixture: ComponentFixture<LoyaltyStripComponent>;

  function render(s: LoyaltySnapshotResponse): HTMLElement {
    fixture = TestBed.createComponent(LoyaltyStripComponent);
    fixture.componentInstance.snapshot = s;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LoyaltyStripComponent] }).compileComponents();
  });

  it('never prints a placeholder article, and uses the right one for every next tier', () => {
    const expected: [LoyaltyTier, string][] = [
      ['bronze', 'Még 100 pont az Ezüst szintig'],
      ['silver', 'Még 500 pont az Arany szintig'],
      ['gold', 'Még 1000 pont a KTE Legenda szintig'],
    ];
    expected.forEach(([tier, text]) => {
      const points = tier === 'bronze' ? 400 : tier === 'silver' ? 1000 : 4000;
      const el = render(snapshot(tier, points));
      expect(el.textContent).toContain(text);
      expect(el.textContent).not.toContain('(z)');
    });
    // and "a Kék" for a tier that sits below nothing is covered by the helper spec
  });

  it('shows halfway between Ezüst (500) and Arany (1500) at 1000 points', () => {
    const el = render(snapshot('silver', 1000));
    const bar = el.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect((el.querySelector('.strip__fill') as HTMLElement).style.width).toBe('50%');
  });

  ORDER.forEach((tier) => {
    it(`${LABELS[tier]}: pill text and progress fill are readable`, () => {
      const el = render(snapshot(tier, tier === 'platinum' ? 6000 : FLOORS[ORDER.indexOf(tier)] + 100));
      const css = (node: Element) => getComputedStyle(node);

      const pill = el.querySelector('.strip__pill') as HTMLElement;
      expect(contrast(parse(css(pill).color), parse(css(pill).backgroundColor))).toBeGreaterThanOrEqual(4.5);

      if (tier === 'platinum') {
        return; // top tier has no bar
      }
      const track = el.querySelector('.strip__bar') as HTMLElement;
      const fill = el.querySelector('.strip__fill') as HTMLElement;
      const trackColor = parse(css(track).backgroundColor);
      const fillColor = parse(css(fill).backgroundColor);
      const edgeColor = parse(css(fill).borderTopColor);
      // The filled part is told apart from the track by its colour or, for the
      // light fills, by its dark edge: one of them must reach 3:1.
      const best = Math.max(contrast(fillColor, trackColor), contrast(edgeColor, trackColor));
      expect(best).toBeGreaterThanOrEqual(3);
    });
  });

  it('gives every tier a different pill, and gold only to Arany', () => {
    const looks = ORDER.map((tier) => {
      const el = render(snapshot(tier, 10));
      const pill = el.querySelector('.strip__pill') as HTMLElement;
      const cs = getComputedStyle(pill);
      return { tier, key: `${cs.backgroundColor}|${cs.color}|${cs.borderTopColor}`, bg: cs.backgroundColor };
    });
    expect(new Set(looks.map((l) => l.key)).size).toBe(4);

    const gold = parse(getComputedStyle(document.documentElement).getPropertyValue('--gold-bg').trim() || '#FBF4DF');
    void gold;
    const goldBg = looks.find((l) => l.tier === 'gold')!.bg;
    looks.filter((l) => l.tier !== 'gold').forEach((l) => expect(l.bg).not.toBe(goldBg));
  });

  it('at the top tier reads as an achievement, not an empty bar', () => {
    const el = render(snapshot('platinum', 6000));
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(el.querySelector('.strip__left')).toBeNull();
    expect(el.textContent).toContain('Elérted a legmagasabb szintet');
    expect(el.textContent).toContain('15% kedvezmény');
    expect(el.querySelector('.strip--top')).not.toBeNull();
  });
});
