import { EmailTemplateService } from './email-template.service';

describe('e-mail change templates', () => {
  const service = new EmailTemplateService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('email-change-confirm: the link to the new address, its life, and that nothing changes without it', () => {
    const out = service.render('email-change-confirm', {
      recipientName: 'Béla',
      newEmail: 'uj@pelda.hu',
      confirmUrl: 'https://jegy.kte.hu/confirm-email/TOKEN123',
      validForLabel: '1 óra',
    });
    expect(out).toContain('href="https://jegy.kte.hu/confirm-email/TOKEN123"');
    expect(out).toContain('uj@pelda.hu');
    expect(out).toContain('1 óra');
    expect(out).toContain('csak egyszer használható');
    expect(out).toContain('semmi nem változik');
  });

  it('email-change-requested: masked address, nothing changed yet, change your password if it was not you; no link', () => {
    const out = service.render('email-change-requested', {
      recipientName: 'Béla',
      maskedNewEmail: 'u***@p***.hu',
      requestedAtLabel: '2026. november 14. 19:30',
      clientLabel: 'Chrome, Windows · 84.2.51.x',
      supportEmail: 'jegy@kte.hu',
    });
    expect(out).toContain('u***@p***.hu');
    expect(out).toContain('Egyelőre semmi nem változott');
    expect(out).toContain('Változtasd meg azonnal a jelszavad');
    expect(out).toContain('Chrome, Windows · 84.2.51.x');
    expect(out).toContain('mailto:jegy@kte.hu');
    expect(out).not.toMatch(/confirm-email/);
  });

  it('email-changed: when, roughly where, the masked new address; no link to the account', () => {
    const out = service.render('email-changed', {
      recipientName: 'Béla',
      maskedNewEmail: 'u***@p***.hu',
      changedAtLabel: '2026. november 14. 19:45',
      supportEmail: 'jegy@kte.hu',
    });
    expect(out).toContain('Az e-mail-címed megváltozott');
    expect(out).toContain('2026. november 14. 19:45');
    expect(out).toContain('u***@p***.hu');
    expect(out).not.toContain('Honnan');
    expect(out).not.toMatch(/href="http/);
  });

  it('password-changed says how it changed: reset link or profile page', () => {
    const base = {
      recipientName: 'Béla',
      changedAtLabel: '2026. november 14. 19:45',
      supportEmail: 'jegy@kte.hu',
    };
    expect(service.render('password-changed', base)).toContain('jelszó-visszaállító linkkel');
    const settings = service.render('password-changed', { ...base, viaSettings: true });
    expect(settings).toContain('a profiloldalon');
    expect(settings).not.toContain('jelszó-visszaállító linkkel');
  });
});
