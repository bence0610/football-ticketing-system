import { capitalArticle, hungarianArticle } from '../../common/hungarian-article';
import { EmailTemplateService } from './email-template.service';

describe('hungarianArticle', () => {
  it('picks a / az by the first sound', () => {
    expect(hungarianArticle('Kecskeméti TE – Újpest FC')).toBe('a');
    expect(hungarianArticle('Újpest FC – Kecskeméti TE')).toBe('az');
    expect(hungarianArticle('MTK Budapest – Kecskeméti TE')).toBe('az');
    expect(hungarianArticle('KTE')).toBe('a');
    expect(hungarianArticle('')).toBe('a');
  });

  it('capitalises for the start of a sentence', () => {
    expect(capitalArticle('Kecskeméti TE – Paksi FC')).toBe('A');
    expect(capitalArticle('Újpest FC – Kecskeméti TE')).toBe('Az');
  });
});

describe('e-mail templates use the right article', () => {
  let service: EmailTemplateService;

  beforeAll(async () => {
    service = new EmailTemplateService();
    await service.onModuleInit();
  });

  const base = {
    recipientName: 'Teszt Elek',
    matchKickoffLabel: '2026. november 9. 20:00',
    matchVenue: 'Széktói Stadion',
    isLender: true,
  };

  it.each([
    ['Kecskeméti TE – Újpest FC', 'a'],
    ['Újpest FC – Kecskeméti TE', 'az'],
  ])('waitlist notification before "%s" -> "%s"', (matchTitle, article) => {
    const html = service.render('waitlist-notification', {
      ...base,
      matchTitle,
    } as never);
    expect(html).toContain(`hely ${article} <strong>${matchTitle.replace(/&/g, '&amp;')}</strong>`);
    expect(html).not.toMatch(/\(z\)/);
  });

  it('seat refund and loan cancellation never print a placeholder', () => {
    for (const matchTitle of ['Kecskeméti TE – Paksi FC', 'Újpest FC – Kecskeméti TE']) {
      const refund = service.render('seat-refund', { ...base, matchTitle } as never);
      const cancelled = service.render('loan-cancelled', { ...base, matchTitle } as never);
      expect(refund).not.toMatch(/\(z\)/);
      expect(cancelled).not.toMatch(/\(z\)/);
      const article = hungarianArticle(matchTitle);
      expect(refund).toContain(`de ${article} <strong>`);
    }
    const cancelledCapital = service.render('loan-cancelled', {
      ...base,
      matchTitle: 'Újpest FC – Kecskeméti TE',
    } as never);
    expect(cancelledCapital).toContain('Az <strong>Újpest FC');
  });
});
