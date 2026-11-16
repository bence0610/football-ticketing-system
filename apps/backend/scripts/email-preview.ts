/**
 * Renders every e-mail with realistic fixtures and optionally sends them.
 *
 *   npx ts-node scripts/email-preview.ts <outDir>                      write .html / .txt files
 *   npx ts-node scripts/email-preview.ts <outDir> --send <address>     ...and send one of each
 *                                                                       through the SMTP in .env
 *
 * The HTML files keep the QR as a data: URL so they show in a browser; the sent mail uses CID
 * attachments (see EmailService), which is what mail clients need.
 */
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import * as QRCode from 'qrcode';
import mailConfig from '../src/config/mail.config';
import { buildFixtures } from '../src/modules/email/email-fixtures';
import { EmailService } from '../src/modules/email/email.service';
import { EmailTemplateService } from '../src/modules/email/email-template.service';

async function main(): Promise<void> {
  loadEnv({ path: resolve(__dirname, '..', '.env') });
  const [outDir, flag, address] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: email-preview.ts <outDir> [--send <address>]');
  }
  mkdirSync(outDir, { recursive: true });

  const templates = new EmailTemplateService();
  await templates.onModuleInit();
  const qr = await QRCode.toDataURL('https://jegy.kte.hu/qr/example', { margin: 1, width: 400 });
  const fixtures = buildFixtures(qr);

  fixtures.forEach((fixture, index) => {
    const name = `${String(index + 1).padStart(2, '0')}-${fixture.template}`;
    const { html, text } = templates.renderBoth(fixture.template, fixture.context, fixture.subject);
    writeFileSync(join(outDir, `${name}.html`), html, 'utf8');
    writeFileSync(join(outDir, `${name}.txt`), text, 'utf8');
    writeFileSync(join(outDir, `${name}.subject.txt`), fixture.subject, 'utf8');
  });
  console.log(`Rendered ${fixtures.length} e-mails to ${outDir}`);

  if (flag === '--send') {
    if (!address) throw new Error('--send needs an address');
    const service = new EmailService({ getOrThrow: () => mailConfig() } as never, templates);
    for (const fixture of fixtures) {
      await service.send({
        to: address,
        subject: fixture.subject,
        template: fixture.template,
        context: fixture.context as never,
        correlationId: `preview:${fixture.template}`,
      });
      console.log(`sent  ${fixture.template.padEnd(24)} ${fixture.subject}`);
      // Mailtrap's sandbox plan refuses bursts ("too many emails per second").
      await new Promise((done) => setTimeout(done, 11_000));
    }
    await service.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
