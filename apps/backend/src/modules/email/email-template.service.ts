import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as Handlebars from 'handlebars';
import { EmailContextMap, EmailTemplateName } from './email.types';
import { capitalArticle, hungarianArticle } from '../../common/hungarian-article';

/** Components shared by every HTML e-mail: `templates/partials/<name>.hbs`. */
const HTML_PARTIALS = ['layout', 'button', 'row', 'details', 'note', 'h1', 'p'] as const;

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Compiles Handlebars templates eagerly at boot and caches them in memory.
 *
 * Every e-mail has two bodies:
 *  - `templates/<name>.hbs`      the HTML version, built on the shared `layout` partial
 *    (tables + inline styles only, Arial; see partials/layout.hbs for the rules);
 *  - `templates/text/<name>.hbs` the plain-text alternative.
 */
@Injectable()
export class EmailTemplateService implements OnModuleInit {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly html = Handlebars.create();
  // Plain text must not HTML-escape ("&", quotes, "="), so it is its own environment.
  private readonly plain = Handlebars.create();
  private readonly compiledHtml = new Map<EmailTemplateName, HandlebarsTemplateDelegate>();
  private readonly compiledText = new Map<EmailTemplateName, HandlebarsTemplateDelegate>();

  private readonly templates: Record<EmailTemplateName, string> = {
    'ticket-confirmation': 'ticket-confirmation.hbs',
    'loan-invitation': 'loan-invitation.hbs',
    'loan-confirmation': 'loan-confirmation.hbs',
    'loan-cancelled': 'loan-cancelled.hbs',
    'tier-upgraded': 'tier-upgraded.hbs',
    'waitlist-notification': 'waitlist-notification.hbs',
    'seat-refund': 'seat-refund.hbs',
    'password-reset': 'password-reset.hbs',
    'password-changed': 'password-changed.hbs',
    'email-change-confirm': 'email-change-confirm.hbs',
    'email-change-requested': 'email-change-requested.hbs',
    'email-changed': 'email-changed.hbs',
  };

  async onModuleInit(): Promise<void> {
    for (const hb of [this.html, this.plain]) {
      hb.registerHelper('eq', (a: unknown, b: unknown): boolean => a === b);
      // Hungarian definite article for the following name: {{article name}} -> a / az,
      // {{Article name}} -> A / Az (sentence start).
      hb.registerHelper('article', (name: unknown): string => hungarianArticle(String(name ?? '')));
      hb.registerHelper('Article', (name: unknown): string => capitalArticle(String(name ?? '')));
      // (concat "a" b "c") -> "a<b>c": builds values for partial parameters.
      hb.registerHelper('concat', (...parts: unknown[]): string =>
        parts
          .slice(0, -1)
          .map((p) => String(p ?? ''))
          .join(''),
      );
    }

    const dir = resolve(__dirname, 'templates');
    for (const name of HTML_PARTIALS) {
      this.html.registerPartial(name, await this.read(resolve(dir, 'partials', `${name}.hbs`)));
    }
    this.plain.registerPartial(
      'text-footer',
      await this.read(resolve(dir, 'partials', 'text-footer.hbs')),
    );

    for (const [name, fileName] of Object.entries(this.templates)) {
      const key = name as EmailTemplateName;
      this.compiledHtml.set(
        key,
        this.html.compile(await this.read(resolve(dir, fileName)), { noEscape: false }),
      );
      this.compiledText.set(
        key,
        this.plain.compile(await this.read(resolve(dir, 'text', fileName)), { noEscape: true }),
      );
    }
    this.logger.log(`Compiled ${this.compiledHtml.size} email templates (html + text)`);
  }

  private async read(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      this.logger.error(`Failed to load email template (${filePath}): ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * `subject` becomes the HTML <title>; it is not part of the typed context. `crest` says the
   * crest image is attached (the header then shows it; otherwise the "KTE" tile).
   */
  render<T extends EmailTemplateName>(
    template: T,
    context: EmailContextMap[T],
    subject = '',
    crest = true,
  ): string {
    return this.delegate(this.compiledHtml, template)({ ...context, subject, crest });
  }

  renderText<T extends EmailTemplateName>(template: T, context: EmailContextMap[T]): string {
    return this.normaliseText(this.delegate(this.compiledText, template)(context));
  }

  renderBoth<T extends EmailTemplateName>(
    template: T,
    context: EmailContextMap[T],
    subject = '',
    crest = true,
  ): RenderedEmail {
    return {
      html: this.render(template, context, subject, crest),
      text: this.renderText(template, context),
    };
  }

  private delegate(
    map: Map<EmailTemplateName, HandlebarsTemplateDelegate>,
    template: EmailTemplateName,
  ): HandlebarsTemplateDelegate {
    const delegate = map.get(template);
    if (!delegate) {
      throw new Error(`Email template not compiled: ${template}`);
    }
    return delegate;
  }

  /** Collapses the blank-line runs that skipped {{#if}} blocks leave behind. */
  private normaliseText(text: string): string {
    return `${text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()}\n`;
  }
}
