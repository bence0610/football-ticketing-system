import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { MailConfig } from '../../config';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateName, SendEmailRequest } from './email.types';

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
    const html = this.templateService.render(request.template, request.context);
    await this.deliverWithRetry(request, html);
  }

  private async deliverWithRetry(
    request: SendEmailRequest,
    html: string,
    attempt = 1,
  ): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.mailConfig.from,
        to: request.to,
        subject: request.subject,
        html,
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
      await this.deliverWithRetry(request, html, attempt + 1);
    }
  }
}
