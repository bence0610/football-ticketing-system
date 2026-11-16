import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import { MailConfig } from '../../config';
import { EmailTemplateService } from './email-template.service';
import { EmailContextMap, EmailTemplateName, SendEmailRequest } from './email.types';

/**
 * Production-grade transactional email sender. Uses Nodemailer over SMTP
 * with a single retry on failure (in-process setTimeout, configurable).
 *
 * The service is intentionally fire-and-forget friendly: callers can
 * `void emailService.send(...)` without blocking the request thread,
 * and failures are logged centrally.
 */
@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly mailConfig: MailConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly templateService: EmailTemplateService,
  ) {
    this.mailConfig = this.configService.getOrThrow<MailConfig>('mail');
    this.transporter = createTransport({
      host: this.mailConfig.host,
      port: this.mailConfig.port,
      secure: this.mailConfig.secure,
      auth: this.mailConfig.user
        ? { user: this.mailConfig.user, pass: this.mailConfig.password }
        : undefined,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.transporter.close();
    } catch (error) {
      this.logger.warn(`Failed to close SMTP transporter: ${(error as Error).message}`);
    }
  }

  async send<T extends EmailTemplateName>(request: SendEmailRequest<T>): Promise<void> {
    // Gmail and Outlook block data: images, so inline images travel as CID attachments.
    const { context, attachments } = extractInlineImages(request.context);
    const { html, text } = this.templateService.renderBoth(
      request.template,
      context as EmailContextMap[T],
      request.subject,
    );
    await this.deliverWithRetry(request, { html, text, attachments });
  }

  private async deliverWithRetry(
    request: SendEmailRequest,
    body: { html: string; text: string; attachments: Attachment[] },
    attempt = 1,
  ): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.mailConfig.from,
        to: request.to,
        subject: request.subject,
        html: body.html,
        text: body.text,
        attachments: body.attachments,
      });
      this.logger.log(
        `Email sent template=${request.template} to=${request.to} attempt=${attempt} messageId=${info.messageId} corr=${request.correlationId ?? '-'}`,
      );
    } catch (error) {
      const err = error as Error;
      if (attempt >= 2) {
        this.logger.error(
          `Email permanently failed template=${request.template} to=${request.to} corr=${request.correlationId ?? '-'}: ${err.message}`,
          err.stack,
        );
        throw err;
      }
      this.logger.warn(
        `Email attempt ${attempt} failed (template=${request.template}, to=${request.to}); retrying in ${this.mailConfig.retryDelayMs}ms: ${err.message}`,
      );
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, this.mailConfig.retryDelayMs),
      );
      await this.deliverWithRetry(request, body, attempt + 1);
    }
  }
}

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif));base64,(.+)$/s;

/**
 * Replaces every `data:image/...;base64,` string in a template context with a `cid:` reference
 * and returns the matching inline attachments. Generic on purpose: callers keep passing the
 * data URLs their QR service produces.
 */
export function extractInlineImages<C>(context: C): { context: C; attachments: Attachment[] } {
  const attachments: Attachment[] = [];
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = DATA_IMAGE.exec(value);
      if (!match) {
        return value;
      }
      const cid = `img${attachments.length + 1}@kte-jegyportal`;
      attachments.push({
        filename: `qr-${attachments.length + 1}.${match[1].split('/')[1]}`,
        content: Buffer.from(match[2], 'base64'),
        contentType: match[1],
        cid,
        contentDisposition: 'inline',
      });
      return `cid:${cid}`;
    }
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
    }
    return value;
  };
  return { context: visit(context) as C, attachments };
}
