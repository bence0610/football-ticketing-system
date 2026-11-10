import { EmailTemplateService } from './email-template.service';

describe('password-changed email', () => {
  const service = new EmailTemplateService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  const html = (clientLabel?: string): string =>
    service.render('password-changed', {
      recipientName: 'Béla',
      changedAtLabel: '2026. november 10. 20:41',
      clientLabel,
      supportEmail: 'jegy@kte.hu',
    });

  it('says when the password changed, and roughly where from', () => {
    const out = html('Chrome, Windows · 84.2.51.x');
    expect(out).toContain('2026. november 10. 20:41');
    expect(out).toContain('Honnan (hozzávetőlegesen)');
    expect(out).toContain('Chrome, Windows · 84.2.51.x');
  });

  it('leaves the "where" out entirely when nothing is known about the client', () => {
    const out = html(undefined);
    expect(out).toContain('2026. november 10. 20:41');
    expect(out).not.toContain('Honnan');
  });

  it('tells them to write to support, with a link, if it was not them', () => {
    const out = html();
    expect(out).toContain('Nem te voltál?');
    expect(out).toContain('mailto:jegy@kte.hu');
    expect(out).toContain('azonnal');
  });

  it('says it carries no password and no link, and has none', () => {
    const out = html();
    expect(out).toContain('nem tartalmazza sem az új jelszót, sem a visszaállító linket');
    expect(out).not.toMatch(/reset-password/);
  });
});
