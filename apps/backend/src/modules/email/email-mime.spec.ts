import { createTransport } from 'nodemailer';
import { EmailFixture, buildFixtures } from './email-fixtures';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';

const QR = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;

/** What EmailService hands to SMTP, captured as a real RFC 822 message. */
describe('e-mail MIME on the wire', () => {
  const templates = new EmailTemplateService();
  let fixtures: EmailFixture[];
  let raw: string[];

  beforeAll(async () => {
    await templates.onModuleInit();
    fixtures = buildFixtures(QR);
    const capture = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const service = new EmailService(
      {
        getOrThrow: () => ({
          host: 'x',
          port: 1,
          secure: false,
          user: '',
          password: '',
          from: 'no-reply@kte.hu',
          retryDelayMs: 1,
        }),
      } as never,
      templates,
    );
    // Route the service's own transporter into the in-memory one.
    (service as unknown as { transporter: unknown }).transporter = capture;
    raw = [];
    const original = capture.sendMail.bind(capture);
    (capture as unknown as { sendMail: unknown }).sendMail = async (m: never) => {
      const info = (await original(m)) as unknown as { message: Buffer };
      raw.push(info.message.toString('utf8'));
      return info;
    };
    for (const f of fixtures) {
      await service.send({
        to: 'x@y.hu',
        subject: f.subject,
        template: f.template,
        context: f.context as never,
      });
    }
  });

  it('every message is multipart/alternative with a text/plain and a text/html part, UTF-8', () => {
    expect(raw).toHaveLength(fixtures.length);
    for (const message of raw) {
      expect(message).toMatch(/Content-Type: multipart\/(alternative|related|mixed)/);
      expect(message).toContain('Content-Type: text/plain; charset=utf-8');
      expect(message).toContain('Content-Type: text/html; charset=utf-8');
    }
  });

  it('subjects survive header encoding (accents and em dash)', () => {
    fixtures.forEach((fixture, i) => {
      const header = /^Subject: ((?:[^\r\n]|\r?\n[ \t])+)/m.exec(raw[i])?.[1] ?? '';
      expect(decodeHeader(header)).toBe(fixture.subject);
    });
  });

  it('QR images are inline CID parts referenced by the HTML, not data: URLs', () => {
    fixtures.forEach((fixture, i) => {
      const message = raw[i];
      const wanted = fixture.template === 'ticket-confirmation' ? 2 : 0;
      const borrowerQr =
        fixture.template === 'loan-confirmation' && fixture.variant.includes('borrower') ? 1 : 0;
      const count = (message.match(/Content-ID: <img\d+@kte-jegyportal>/g) ?? []).length;
      expect(count).toBe(wanted + borrowerQr);
      expect(message).not.toContain('data:image');
    });
  });
});

/**
 * RFC 2047 decoder. Adjacent encoded words are joined as BYTES before UTF-8 decoding, because a
 * multi-byte character may be split across two words.
 */
function decodeHeader(header: string): string {
  const tokens = header
    .replace(/\r?\n[ \t]/g, ' ')
    .trim()
    .split(/\s+/);
  let out = '';
  let pending: Buffer[] = [];
  const flush = (): void => {
    if (pending.length) {
      out += Buffer.concat(pending).toString('utf8');
      pending = [];
    }
  };
  for (const token of tokens) {
    const word = /^=\?UTF-8\?([BQ])\?([^?]*)\?=$/i.exec(token);
    if (word) {
      pending.push(
        word[1].toUpperCase() === 'B'
          ? Buffer.from(word[2], 'base64')
          : Buffer.from(
              word[2]
                .replace(/_/g, ' ')
                .replace(/=([0-9A-F]{2})/gi, (_m, h: string) =>
                  String.fromCharCode(parseInt(h, 16)),
                ),
              'latin1',
            ),
      );
    } else {
      flush();
      out += (out ? ' ' : '') + token;
    }
  }
  flush();
  return out;
}
