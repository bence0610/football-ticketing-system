import { EmailTemplateService } from './email-template.service';

describe('password-reset email', () => {
  const service = new EmailTemplateService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  const html = (): string =>
    service.render('password-reset', {
      recipientName: 'Béla',
      resetUrl: 'http://localhost:4200/reset-password/abc123',
      validForLabel: '1 óra',
    });

  it('carries the link, for the button and as plain text', () => {
    const out = html();
    expect(
      out.match(/http:\/\/localhost:4200\/reset-password\/abc123/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('says how long the link lasts and that it works once', () => {
    const out = html();
    expect(out).toContain('1 óra');
    expect(out).toContain('csak egyszer használható');
  });

  it('says plainly that nothing has happened if they did not ask for it', () => {
    const out = html();
    expect(out).toContain('Nem te kérted?');
    expect(out).toContain('a fiókoddal semmi nem történt');
    expect(out).toContain('a jelszavad változatlan');
  });
});
