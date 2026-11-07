import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ChatbotPanelComponent } from './chatbot-panel.component';
import { ChatbotStore } from './state/chatbot.signals';

/**
 * Real store + real panel + real HttpClient against a mocked backend that
 * behaves like the ownership-checked API: the first call has no conversationId
 * and gets one back; continuing must send that id.
 */
describe('ChatbotPanelComponent — continuous conversation', () => {
  let fixture: ComponentFixture<ChatbotPanelComponent>;
  let http: HttpTestingController;
  let store: ChatbotStore;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ChatbotPanelComponent],
      providers: [provideNoopAnimations(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ChatbotPanelComponent);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ChatbotStore);
    el = fixture.nativeElement;
    fixture.detectChanges();
    // NgModel's initial writeValue is async; settle it before the test types.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const input = () => el.querySelector<HTMLInputElement>('input[name="message"]')!;
  const sendBtn = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const texts = () =>
    Array.from(el.querySelectorAll('kte-chatbot-message')).map((m) => m.textContent!.trim());

  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function clickSend(): Promise<void> {
    sendBtn().click();
    fixture.detectChanges();
  }

  async function reply(conversationId: string, text: string) {
    const req = http.expectOne((r) => r.url.endsWith('/chatbot/message'));
    req.flush({ conversationId, reply: text, model: 'm' });
    await fixture.whenStable();
    fixture.detectChanges();
    return req.request;
  }

  it('sends a second message after the first reply, carrying the server-issued id', async () => {
    await type('első kérdés');
    expect(sendBtn().disabled).withContext('send enabled once text is typed').toBeFalse();
    await clickSend();
    const first = await reply('conv-1', 'első válasz');
    expect(first.body.conversationId).toBeUndefined();

    expect(input().disabled).withContext('input usable after reply').toBeFalse();

    await type('második kérdés');
    expect(sendBtn().disabled).withContext('send enabled for 2nd message').toBeFalse();
    await clickSend();
    const second = await reply('conv-1', 'második válasz');
    expect(second.body).toEqual({ message: 'második kérdés', conversationId: 'conv-1' });

    const all = texts().join(' | ');
    expect(all).toContain('első válasz');
    expect(all).toContain('második kérdés');
    expect(all).toContain('második válasz');
  });

  it('suggested questions work at any time, also mid-conversation', async () => {
    const chips = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.kte-chatbot-panel__chip'));
    expect(chips().length).toBeGreaterThan(0);

    chips()[0].click();
    fixture.detectChanges();
    await reply('conv-1', 'a');

    // Conversation is no longer empty; chips must still be there and work.
    expect(chips().length).toBeGreaterThan(1);
    expect(chips()[1].disabled).toBeFalse();
    const label = chips()[1].textContent!.trim();
    chips()[1].click();
    fixture.detectChanges();
    const req = await reply('conv-1', 'b');
    expect(req.body).toEqual({ message: label, conversationId: 'conv-1' });
    expect(texts().join(' | ')).toContain('b');
  });

  it('a failed message leaves the input usable and the retry goes through', async () => {
    await type('hibás');
    await clickSend();
    http
      .expectOne((r) => r.url.endsWith('/chatbot/message'))
      .flush({ message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    // NgModel applies [disabled] to the DOM one microtask after change detection.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(input().disabled).toBeFalse();

    await type('újra');
    expect(sendBtn().disabled).toBeFalse();
    await clickSend();
    await reply('conv-2', 'sikerült');
    expect(texts().join(' ')).toContain('sikerült');
  });

  it('after the server rejects the conversation (403/404) the next message starts fresh', async () => {
    await type('egy');
    await clickSend();
    await reply('conv-1', 'ok');

    await type('kettő');
    await clickSend();
    http
      .expectOne((r) => r.url.endsWith('/chatbot/message'))
      .flush({ message: 'Ez a beszélgetés nem található vagy lejárt.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('lejárt');

    await type('három');
    await clickSend();
    const req = await reply('conv-3', 'új');
    expect(req.body.conversationId).toBeUndefined();
  });
});
