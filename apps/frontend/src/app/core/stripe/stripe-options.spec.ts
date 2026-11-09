import { STRIPE_FONT_FAMILY, STRIPE_FONTS_CSS, stripeAppearance, stripeFonts } from './stripe-options';

describe('Stripe element options', () => {
  it('points the fonts option at this app, as an absolute URL', () => {
    const [font] = stripeFonts('http://localhost:4200/') as { cssSrc: string }[];
    expect(font.cssSrc).toBe('http://localhost:4200/' + STRIPE_FONTS_CSS);
  });

  it('respects a non-root base href', () => {
    const [font] = stripeFonts('https://example.hu/jegyek/') as { cssSrc: string }[];
    expect(font.cssSrc).toBe('https://example.hu/jegyek/assets/stripe/stripe-fonts.css');
  });

  it('uses the family the stylesheet declares', () => {
    expect(stripeAppearance().variables?.fontFamily).toBe(STRIPE_FONT_FAMILY);
    expect(STRIPE_FONT_FAMILY).toContain("'IBM Plex Sans'");
  });
});
