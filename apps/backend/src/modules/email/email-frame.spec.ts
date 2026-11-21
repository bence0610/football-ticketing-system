import { TIER_DEFINITIONS } from '../loyalty/loyalty.constants';
import loyaltyConfig from '../../config/loyalty.config';
import { EmailFixture, buildFixtures } from './email-fixtures';
import { EmailTemplateService } from './email-template.service';
import { extractInlineImages } from './email.service';
import { matchSubjectLabel, shortTeamName } from './email-subject';

const QR = `data:image/png;base64,${Buffer.from('not-really-a-png').toString('base64')}`;

/** Which fixtures carry the one primary action; the rest are information only. */
const HAS_BUTTON = new Set([
  'loan-invitation',
  'loan-confirmation',
  'ticket-confirmation',
  'tier-upgraded',
  'waitlist-notification',
  'password-reset',
  'email-change-confirm',
  'email-verification',
]);

describe('shared e-mail frame', () => {
  const service = new EmailTemplateService();
  let fixtures: EmailFixture[];

  beforeAll(async () => {
    await service.onModuleInit();
    fixtures = buildFixtures(QR);
  });

  const render = (fixture: EmailFixture) => {
    // The same path EmailService.send takes: inline images become CID attachments first.
    const { context, attachments } = extractInlineImages(fixture.context);
    const out = service.renderBoth(fixture.template, context as never, fixture.subject);
    return { ...out, attachments };
  };
  const find = (template: string, variant?: string): EmailFixture => {
    const found = fixtures.find(
      (f) => f.template === template && (!variant || f.variant.includes(variant)),
    );
    if (!found) throw new Error(`no fixture ${template}/${variant}`);
    return found;
  };

  it('covers all 13 templates', () => {
    expect(new Set(fixtures.map((f) => f.template)).size).toBe(13);
  });

  describe.each([
    'loan-invitation',
    'loan-confirmation',
    'loan-cancelled',
    'ticket-confirmation',
    'tier-upgraded',
    'waitlist-notification',
    'seat-refund',
    'password-reset',
    'password-changed',
    'email-change-confirm',
    'email-change-requested',
    'email-changed',
    'email-verification',
  ])('%s', (template) => {
    const variants = () => fixtures.filter((f) => f.template === template);

    it('uses the shared frame: brand/amber band, mark + product name, grey footer, Arial only', () => {
      for (const fixture of variants()) {
        const { html } = render(fixture);
        expect(html).toMatch(/bgcolor="(#4a1d6a|#8A5300)"/);
        // the crest sits on a white plate (it is purple: it would vanish on the band) and is a CID image
        expect(html).toMatch(
          /<td[^>]*bgcolor="#ffffff"[^>]*>\s*<img src="cid:crest@kte-jegyportal"[^>]*alt="KTE"/,
        );
        expect(html).toMatch(/<img src="cid:crest@kte-jegyportal" width="40" height="45"/);
        expect(html).toContain('KTE Jegyportál</td>');
        expect(html).toContain('bgcolor="#ece9f0"');
        expect(html).toContain('<table role="presentation" width="600"');
        expect(html).toMatch(/font-family:Arial, Helvetica, sans-serif/);
        expect(html).not.toMatch(/archivo|font-face|@import|<link|<script/i);
      }
    });

    it('uses only email-safe layout: no flex/grid/float/position, no CSS variables, no remote or data images', () => {
      for (const fixture of variants()) {
        const { html } = render(fixture);
        expect(html).not.toMatch(/display:\s*(flex|grid|inline-flex)/i);
        expect(html).not.toMatch(/\b(float|position|gap|grid-template[\w-]*)\s*:/i);
        expect(html).not.toMatch(/var\(--|background-image|url\(/i);
        expect(html).not.toMatch(/src="(?!cid:)/);
        // Only tables lay things out: the single <div> allowed is the hidden preheader.
        expect((html.match(/<div/g) ?? []).length).toBeLessThanOrEqual(1);
        // max-width alone is ignored by Outlook; the fixed width attribute must be there too.
        expect(html).toMatch(/width="600"[^>]*max-width:600px/);
      }
    });

    it('has no unresolved placeholders in either body', () => {
      for (const fixture of variants()) {
        const { html, text } = render(fixture);
        for (const body of [html, text]) {
          expect(body).not.toMatch(/\{\{|\}\}|undefined|\[object Object\]|\(z\)/);
        }
      }
    });

    it('has a real plain-text alternative: no markup, greets, ends with the footer', () => {
      for (const fixture of variants()) {
        const { text } = render(fixture);
        expect(text.length).toBeGreaterThan(200);
        expect(text).not.toMatch(/<\/?[a-z][^>]*>|&(amp|nbsp|#x?\d+);/i);
        expect(text).toContain('KTE Jegyportál · Kecskeméti TE');
      }
    });

    it('offers exactly one primary action where there is one, none elsewhere', () => {
      for (const fixture of variants()) {
        const { html } = render(fixture);
        const buttons = (html.match(/class="kte-cta"/g) ?? []).length;
        const expected = HAS_BUTTON.has(template) ? 1 : 0;
        expect(buttons).toBe(expected);
        // ...and its VML twin for Outlook.
        expect((html.match(/<v:roundrect/g) ?? []).length).toBe(expected);
      }
    });
  });

  it('header: without the crest file the "KTE" tile stands in, with no dangling image', () => {
    const fixture = find('password-reset');
    const html = service.render(fixture.template, fixture.context as never, fixture.subject, false);
    expect(html).not.toContain('crest@kte-jegyportal');
    expect(html).toMatch(/bgcolor="#ffffff"[^>]*>KTE<\/td>/);
    expect(html).toContain('KTE Jegyportál</td>');
  });

  it('header: blocked images leave a readable tile - alt text styled like the tile, name beside it', () => {
    const { html } = render(find('password-reset'));
    const img = /<img src="cid:crest[^>]*>/.exec(html)![0];
    expect(img).toMatch(/alt="KTE"/);
    expect(img).toMatch(/font-weight:bold/);
    expect(img).toMatch(/color:#4a1d6a/);
    expect(html).toContain('KTE Jegyportál</td>');
  });

  it('button URL appears as a link in the plain text too', () => {
    for (const fixture of fixtures.filter((f) => HAS_BUTTON.has(f.template))) {
      const { text } = render(fixture);
      expect(text).toMatch(/https:\/\/jegy\.kte\.hu\/\S+/);
    }
  });

  it('inline QR images travel as CID attachments, never as data: URLs', () => {
    const borrower = render(find('loan-confirmation', 'borrower'));
    expect(borrower.attachments).toHaveLength(1);
    expect(borrower.html).toContain(`src="cid:${borrower.attachments[0].cid}"`);
    expect(borrower.html).not.toContain('data:image');
    const tickets = render(find('ticket-confirmation'));
    expect(tickets.attachments).toHaveLength(2);
    expect(tickets.attachments.every((a) => a.contentDisposition === 'inline')).toBe(true);
  });

  describe('subjects name the sender and the match', () => {
    it('formats the match like the inbox line "KTE–Újpest, nov. 29."', () => {
      expect(
        matchSubjectLabel({
          homeTeam: 'Kecskeméti TE',
          awayTeam: 'Újpest FC',
          kickoffAt: new Date('2026-11-09T19:00:00Z'),
        }),
      ).toBe('KTE–Újpest, nov. 9.');
      expect(shortTeamName('Kecskeméti TE')).toBe('KTE');
      expect(shortTeamName('Újpest FC')).toBe('Újpest');
      expect(shortTeamName('Ferencvárosi TC')).toBe('Ferencvárosi');
    });

    it.each([
      ['loan-invitation', 'Szabó Bence átadja a helyét — KTE–Újpest, nov. 29.'],
      ['loan-confirmation', 'Szabó Bence helye a tiéd, itt a belépőd — KTE–Újpest, nov. 29.'],
      ['loan-cancelled', 'Szabó Bence visszavonta a kölcsönt — KTE–Újpest, nov. 29.'],
      ['ticket-confirmation', 'Megvan a jegyed — KTE–Újpest, nov. 29.'],
      ['waitlist-notification', 'Felszabadult egy hely: D/1 szektor — KTE–Újpest, nov. 29.'],
    ])('%s', (template, subject) => {
      expect(fixtures.some((f) => f.template === template && f.subject === subject)).toBe(true);
    });
  });

  describe('per-email content', () => {
    it('loan invitation repeats every detail and says doing nothing has no consequence', () => {
      const { html, text } = render(find('loan-invitation'));
      for (const body of [html, text]) {
        expect(body).toContain('Szabó Bence');
        expect(body).toContain('Kecskeméti TE - Újpest FC');
        expect(body).toContain('2026. november 29. (vasárnap) 15:00');
        expect(body).toContain('Széktói Stadion');
        expect(body).toContain('D/1 szektor / 7. sor / 12. szék');
        expect(body).toContain('Ha nem teszel semmit, nem történik semmi');
        expect(body).toContain('téged semmi nem kötelez');
      }
      // The invitee may have no account: no made-up name from the address.
      expect(html).toContain('Szia!');
    });

    it('loan accepted (lender): who accepted, own entry void, pass works at the next match', () => {
      const { html } = render(find('loan-confirmation', 'lender'));
      expect(html).toContain('Kiss Anna');
      expect(html).toContain('a te saját belépésed erre a meccsre érvénytelen');
      expect(html).toContain('következő meccsen újra működik');
      // no QR: the crest is the only image in the lender's mail
      expect(html.match(/<img/g)).toHaveLength(1);
    });

    it('loan accepted (borrower): names the lender, not themselves', () => {
      const { html } = render(find('loan-confirmation', 'borrower'));
      expect(html).toContain('Elfogadtad <strong>Szabó Bence</strong>');
      expect(html).not.toContain('Elfogadtad <strong>Kiss Anna</strong>');
    });

    it('loan withdrawn (borrower): amber band, QR dead, nothing paid, nothing to refund', () => {
      const { html, text } = render(find('loan-cancelled'));
      expect(html).toContain('bgcolor="#8A5300"');
      for (const body of [html, text]) {
        expect(body).toContain('QR-kód nem fog működni');
        expect(body).toContain('Nem fizettél semmit, ezért nincs mit visszatéríteni');
      }
    });

    it('loan withdrawn before acceptance does not talk about a QR that was never issued', () => {
      const base = find('loan-cancelled').context as unknown as Record<string, unknown>;
      const html = service.render('loan-cancelled', { ...base, qrIssued: false } as never);
      expect(html).not.toContain('QR');
      expect(html).toContain('A meghívó már nem érvényes');
    });

    it('ticket confirmation: fixture, seat, amount paid; points are promised for attending, never for buying; no invoice promise', () => {
      const { html, text } = render(find('ticket-confirmation'));
      const points = loyaltyConfig().attendancePoints;
      for (const body of [html, text]) {
        expect(body).toContain('Kecskeméti TE - Újpest FC');
        expect(body).toContain('D/1 szektor / 7. sor / 12. szék');
        expect(body).toContain('9 000 HUF');
        // loyalty measures attendance: once per match, after the entry is scanned; buying earns nothing
        expect(body).toContain(`meccsenként egyszer ${points} pont jár`);
        expect(body).toContain('A jegyvásárlásért nem jár pont');
        expect(body).not.toContain('Gyűjtött hűségpont');
        expect(body).not.toMatch(/számla|invoice/i);
      }
    });

    it('tier upgrade: the new tier and what it gives, from the real tier table', () => {
      const { html } = render(find('tier-upgraded'));
      expect(html).toContain('Ezüst');
      expect(html).toContain('5% kedvezmény minden új jegyvásárlásból');
      // 550 points in the fixture: what is missing to Arany comes from the real tier table
      expect(html).toContain(`Arany, még ${TIER_DEFINITIONS[2].minPoints - 550} pont`);
    });

    it('waitlist: which sector, plainly not reserved, no settings/unsubscribe link', () => {
      const { html, text } = render(find('waitlist-notification'));
      for (const body of [html, text]) {
        expect(body).toContain('D/1 szektor');
        expect(body).toMatch(/nincs lefoglalva/i);
        expect(body).toContain('Aki előbb megveszi, azé lesz');
        expect(body).not.toMatch(/leiratkoz|unsubscribe|értesítési beállítás/i);
      }
      // Without a known sector the mail still reads correctly.
      const base = find('waitlist-notification').context as unknown as Record<string, unknown>;
      const generic = service.render('waitlist-notification', {
        ...base,
        freedSectorName: undefined,
      } as never);
      expect(generic).not.toContain('Felszabadult hely');
      expect(generic).not.toContain('()');
    });
  });
});
