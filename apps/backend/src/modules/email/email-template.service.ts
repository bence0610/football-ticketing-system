import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as Handlebars from 'handlebars';
import { EmailContextMap, EmailTemplateName } from './email.types';

/**
 * Compiles Handlebars templates eagerly at boot and caches them in memory.
 * Templates live in `templates/<name>.hbs` and are KTE-branded HTML emails
 * with inline CSS so they render reliably in Gmail / Outlook / Apple Mail.
 */
@Injectable()
export class EmailTemplateService implements OnModuleInit {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly compiled = new Map<EmailTemplateName, HandlebarsTemplateDelegate>();

  private readonly templates: Record<EmailTemplateName, string> = {
    'ticket-confirmation': 'ticket-confirmation.hbs',
    'loan-invitation': 'loan-invitation.hbs',
    'loan-confirmation': 'loan-confirmation.hbs',
    'loan-cancelled': 'loan-cancelled.hbs',
    'tier-upgraded': 'tier-upgraded.hbs',
    'waitlist-notification': 'waitlist-notification.hbs',
  };

  async onModuleInit(): Promise<void> {
    Handlebars.registerHelper('eq', (a: unknown, b: unknown): boolean => a === b);
    for (const [name, fileName] of Object.entries(this.templates)) {
      const filePath = resolve(__dirname, 'templates', fileName);
      try {
        const source = await fs.readFile(filePath, 'utf8');
        this.compiled.set(
          name as EmailTemplateName,
          Handlebars.compile(source, { noEscape: false }),
        );
      } catch (error) {
        this.logger.error(
          `Failed to load email template ${name} (${filePath}): ${(error as Error).message}`,
        );
        throw error;
      }
    }
    this.logger.log(`Compiled ${this.compiled.size} email templates`);
  }

  render<T extends EmailTemplateName>(template: T, context: EmailContextMap[T]): string {
    const delegate = this.compiled.get(template);
    if (!delegate) {
      throw new Error(`Email template not compiled: ${template}`);
    }
    return delegate(context);
  }
}
