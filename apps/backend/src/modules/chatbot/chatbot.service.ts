import Anthropic from '@anthropic-ai/sdk';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AnthropicConfig } from '../../config';
import {
  ChatbotContextService,
  ChatbotContextSnapshot,
  ChatbotLoyaltySnapshot,
  ChatbotMatchSnapshot,
  ChatbotRulesSnapshot,
  ChatbotSectorSnapshot,
} from './chatbot-context.service';
import { ChatbotHistoryService, ChatbotMessage } from './chatbot-history.service';

const SYSTEM_PROMPT_HEADER = `Te a "KTE AI Asszisztens" vagy, a Kecskeméti TE (KTE) hivatalos jegyportáljának chatbotja.
Magyar nyelven, segítőkészen és tömören válaszolj a szurkolóknak.

Felelősséged:
- Meccs információk (időpont, hely, ellenfél, jegyárak)
- Jegyvásárlási folyamat segítsége
- Hűségprogram és bérletek magyarázata
- Stadion információk (Széktói Stadion, Kecskemét)
- Általános KTE klubinformációk

Ha nem tudod a választ, irányítsd a felhasználót az ügyfélszolgálathoz: jegy@kte.hu.
A személyes adatokra (saját jegy, saját rendelés) vonatkozó kérdéseket utasítsd el — azokat a profil oldalon érheti el a felhasználó.

Szigorú szabályok a számokra és tényekre:
- Számot (szabad hely, eladott jegy, ár, kapacitás, százalék, dátum) CSAK akkor mondhatsz, ha szó szerint szerepel az alábbi pillanatképben. Soha ne becsülj, ne kerekíts, ne számolj ki új számot, és ne következtess hiányzó adatból.
- Ha a kért adat nincs a pillanatképben (például egy szektor, egy meccs vagy egy érték hiányzik, vagy "nem elérhető" áll mellette), mondd meg egyenesen, hogy ezt nem tudod, és irányítsd a felhasználót a jegyvásárlási oldalra vagy a jegy@kte.hu címre.
- A szektor fedettsége (fedett / nem fedett) állandó adat: ha a pillanatkép megadja, válaszolj róla közvetlenül (például a „melyik szektor fedett?” kérdésre sorold fel a fedett szektorokat), időbélyeges figyelmeztetés nélkül. Ha a fedettség mellett „nem elérhető” áll, mondd meg, hogy ezt nem tudod.
- Csak a szabad, eladott és zárolt helyek számai mozognak gyorsan: ezek a pillanatkép készítésének idejét tükrözik, ezért CSAK akkor jelezd (a pillanatkép időpontjával), hogy közben változhattak, ha ilyen számot mondasz. Az árakra (alapár, szektorárak) és a hűségprogram szabályaira ezt NE mondd: azok nem változnak a pillanatkép érvényességi idején belül. Ha csak árat vagy szabályt közölsz, ne tégy hozzá időbélyeges figyelmeztetést. Az időjárás előrejelzés: így mutasd be, és jelezd, hogy a kezdésig változhat.
- A vendégszektor kizárólag vendégszurkolóké: a portálon nem vásárolható, bérlet sem váltható rá. Soha ne ajánld jegyvásárlásra vagy helyválasztásra, akkor sem, ha a felhasználó olcsó vagy sok szabad helyet keres.
- Hogy egy meccs hazai vagy idegenbeli-e, azt kizárólag a "Hazai/idegenbeli" sor mondja meg; ne találgasd.

A pillanatkép a mérkőzések mellett a hűségprogram szabályait is tartalmazza; a hűségprogramról ezek alapján válaszolj, az ott szereplő számokat kimondhatod. A felhasználó saját pontjait és szintjét nem ismered — erre a profil oldalra irányítsd.

A jelenleg ismert adatok:`;

export interface ChatbotReply {
  conversationId: string;
  reply: string;
  model: string;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly anthropicConfig: AnthropicConfig;
  private readonly client: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly contextService: ChatbotContextService,
    private readonly historyService: ChatbotHistoryService,
  ) {
    this.anthropicConfig = this.configService.getOrThrow<AnthropicConfig>('anthropic');
    this.client = new Anthropic({ apiKey: this.anthropicConfig.apiKey });
  }

  describe(): { model: string; status: 'configured' } {
    return { model: this.anthropicConfig.model, status: 'configured' };
  }

  /**
   * Single-shot prompt to Claude with prompt caching enabled on the system
   * block (the upcoming-matches snapshot rarely changes within a 5 minute
   * window). Conversation history is loaded from Redis, the new user
   * message is prepended, and both turns are persisted after the response.
   *
   * Uses the beta `prompt-caching-2024-07-31` header so `cache_control`
   * markers are honored on system blocks.
   */
  async sendMessage(params: {
    message: string;
    conversationId?: string;
    userLabel?: string;
    /** Identity the conversation is bound to, see {@link resolveChatbotOwner}. */
    owner: string;
  }): Promise<ChatbotReply> {
    const requestedId = params.conversationId?.trim();
    const conversationId = requestedId || randomUUID();
    const trimmed = params.message.trim();
    if (!trimmed) {
      throw new InternalServerErrorException('Üres üzenet nem küldhető.');
    }

    if (requestedId) {
      await this.assertOwnsConversation(requestedId, params.owner);
    }

    const [history, context] = await Promise.all([
      this.historyService.load(conversationId),
      this.contextService.getUpcomingMatchesSnapshot(),
    ]);

    // System blocks: header (small, not cached) + matches snapshot (cached).
    // The snapshot is keyed by the Redis cache TTL (5 min) so the cache hit
    // rate stays high across the same window.
    const systemBlocks = [
      { type: 'text' as const, text: SYSTEM_PROMPT_HEADER },
      {
        type: 'text' as const,
        text: this.formatContextBlock(context),
        cache_control: { type: 'ephemeral' as const },
      },
    ];

    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: trimmed },
    ];

    let assistantText: string;
    try {
      const response = await this.client.beta.promptCaching.messages.create({
        model: this.anthropicConfig.model,
        max_tokens: this.anthropicConfig.maxTokens,
        system: systemBlocks,
        messages,
      });
      assistantText = this.extractText(response);
      this.logger.log(
        `Chatbot reply conv=${conversationId} user=${params.userLabel ?? 'anon'} in=${response.usage.input_tokens} out=${response.usage.output_tokens} cache_read=${response.usage.cache_read_input_tokens ?? 0} cache_create=${response.usage.cache_creation_input_tokens ?? 0}`,
      );
    } catch (error) {
      this.logger.error(this.describeAnthropicFailure(error));
      throw new ServiceUnavailableException(
        'A chatbot szolgáltatás jelenleg nem elérhető. Próbáld újra később.',
      );
    }

    const now = new Date().toISOString();
    const userTurn: ChatbotMessage = { role: 'user', content: trimmed, createdAt: now };
    const assistantTurn: ChatbotMessage = {
      role: 'assistant',
      content: assistantText,
      createdAt: now,
    };
    if (requestedId) {
      await this.historyService.touchOwner(conversationId);
    } else {
      await this.historyService.claim(conversationId, params.owner);
    }
    await this.historyService.append(conversationId, userTurn);
    await this.historyService.append(conversationId, assistantTurn);

    return {
      conversationId,
      reply: assistantText,
      model: this.anthropicConfig.model,
    };
  }

  /**
   * Log-only diagnosis; the user always gets the same generic 503. Classified
   * by HTTP status so it does not depend on SDK class identity.
   */
  private describeAnthropicFailure(error: unknown): string {
    const model = this.anthropicConfig.model;
    const err = error as { status?: number; message?: string; headers?: Record<string, string> };
    const status = typeof err?.status === 'number' ? err.status : undefined;
    const detail = `status=${status ?? 'none'} model=${model} message=${err?.message ?? String(error)}`;
    switch (status) {
      case 401:
        return `Anthropic AUTHENTICATION failure: check ANTHROPIC_API_KEY (missing, invalid or revoked). ${detail}`;
      case 403:
        return `Anthropic PERMISSION denied: the key may not use this model or workspace. ${detail}`;
      case 404:
        return `Anthropic UNKNOWN MODEL: "${model}" not found, likely retired; update ANTHROPIC_MODEL. ${detail}`;
      case 429:
        return `Anthropic RATE LIMIT hit (retry-after=${err.headers?.['retry-after'] ?? 'n/a'}). ${detail}`;
      case 529:
        return `Anthropic OVERLOADED. ${detail}`;
      case undefined:
        return `Anthropic call failed without an HTTP response (network/timeout?). ${detail}`;
      default:
        return `Anthropic call failed. ${detail}`;
    }
  }

  /**
   * Only the caller who started a conversation may continue it. An id the
   * server never issued (or that expired) is rejected too: adopting a
   * client-chosen id would let anyone squat on a guessable one.
   */
  private async assertOwnsConversation(conversationId: string, owner: string): Promise<void> {
    let storedOwner: string | null;
    try {
      storedOwner = await this.historyService.getOwner(conversationId);
    } catch (error) {
      this.logger.error(`Conversation owner lookup failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'A chatbot szolgáltatás jelenleg nem elérhető. Próbáld újra később.',
      );
    }
    if (storedOwner === null) {
      throw new NotFoundException(
        'Ez a beszélgetés nem található vagy lejárt. Indíts új beszélgetést.',
      );
    }
    if (storedOwner !== owner) {
      this.logger.warn(`Conversation ${conversationId} continuation rejected: owner mismatch`);
      throw new ForbiddenException('Ezt a beszélgetést nem folytathatod.');
    }
  }

  private extractText(response: Anthropic.Beta.PromptCaching.PromptCachingBetaMessage): string {
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }
    const joined = parts.join('').trim();
    return joined || 'Sajnálom, jelenleg nem tudok választ adni.';
  }

  private formatContextBlock(context: ChatbotContextSnapshot): string {
    const matches = context.upcomingMatches;
    const generalSections = [
      this.formatSeasonPass(context),
      this.formatRules(context.rules),
      this.formatLoyalty(context.loyalty),
    ].join('\n\n');
    if (matches.length === 0) {
      return `Jelenleg nincs közelgő mérkőzés a rendszerben.\n\n${generalSections}`;
    }
    const generatedLabel = new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Budapest',
    }).format(new Date(context.generatedAt));
    const lines: string[] = [`A pillanatkép készült: ${generatedLabel}`];
    for (const match of matches) {
      const kickoff = new Date(match.kickoffAt);
      const dateLabel = new Intl.DateTimeFormat('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Budapest',
      }).format(kickoff);
      lines.push(
        `- ${match.homeTeam} vs ${match.awayTeam} (${match.competition})
  Hazai/idegenbeli: ${match.isHome ? 'hazai mérkőzés (a KTE otthon játszik)' : 'idegenbeli mérkőzés'}
  Időpont: ${dateLabel}, helyszín: ${match.venue}
  Alapár: ${match.basePrice.toLocaleString('hu-HU')} Ft, kapacitás: ${match.capacity}
  Elkelt: ${match.soldSeats} (${match.occupancyPercent}%), szabad: ${match.availableSeats}
  Szektorok: ${this.formatSectors(match)}
  Időjárás-előrejelzés a kezdésre: ${this.formatWeather(match)}${match.description ? `\n  Leírás: ${match.description}` : ''}
  Státusz: ${match.status}`,
      );
    }
    lines.push(generalSections);
    return lines.join('\n\n');
  }

  private formatWeather(match: ChatbotMatchSnapshot): string {
    // `weather` is absent in snapshots cached before it existed.
    const w = match.weather;
    if (!w) {
      return 'nem elérhető (a kezdés még túl messze van, vagy nincs adat)';
    }
    return `${w.summary}, ${w.temperatureCelsius} °C, csapadék valószínűsége ${w.precipitationProbabilityPercent}%${w.rainWarning ? ', esőre figyelmeztetés' : ''}`;
  }

  private formatSeasonPass(context: ChatbotContextSnapshot): string {
    const sp = context.seasonPass;
    if (!sp) {
      return 'Bérletek: az árlista jelenleg nem elérhető; árat ne mondj, a bérletoldalra irányíts.';
    }
    const fmt = (n: number) => `${n.toLocaleString('hu-HU')} Ft`;
    const prices = sp.prices.map((p) => `  - ${p.sectionName}: ${fmt(p.price)}`).join('\n');
    return [
      `Bérletek (${sp.seasonLabel} szezon, érvényes ${sp.validFrom} első napjától ${sp.validUntil} utolsó napjának végéig; az első és az utolsó napon játszott mérkőzés is lefedett, a napokat a stadion időzónájában, Europe/Budapest szerint számítjuk):`,
      prices,
      '  A bérlet a választott szektorban fix helyet ad az érvényességi időszakba eső mérkőzésekre; minden mérkőzéshez a profil oldalon érhető el a belépő QR-kód.',
      '  Egy fiók szezononként egy bérlet birtokosa lehet. Megvehető másnak is (családtag, gyerek): ilyenkor a vásárláskor meg kell adni a birtokos nevét, vagy ha van fiókja, az e-mail-címét.',
      '  Ha egy szektorban elfogytak a bérletes helyek, abban a szektorban nem lehet bérletet venni.',
    ].join('\n');
  }

  private formatRules(r: ChatbotRulesSnapshot): string {
    return [
      'Jegyvásárlás és szabályok:',
      `  - Kiválasztott székedet ${r.seatHoldMinutes} percig tartjuk fenn a fizetésig; egy vásárlásban legfeljebb ${r.maxSeatsPerOrder} jegy vehető.`,
      '  - Belépés: minden jegyhez és bérlethez QR-kód tartozik (a profil oldalon), ezt kell a kapunál beolvastatni. Egy QR-kód egyszer használható; a meccs után a fel nem használt jegy lejár.',
      '  - Bérletkölcsönzés: a bérlet tulajdonosa egy adott mérkőzésre e-mailben meghívhat valakit a helyére.',
      `    A meghívó ${r.loanInvitationTtlHours} óráig érvényes, és csak a meghívott e-mail-címmel fogadható el. Nem kölcsönözhető saját magadnak, a bérlet vevőjének/birtokosának, már megkezdett mérkőzésre, és olyan mérkőzésre sem, amelyre a bérlettel már beléptek, vagy amelyre már van folyamatban lévő kölcsönzés.`,
      '    Amíg a kölcsönzés elfogadott, a belépés joga a kölcsönvevőé; a kölcsönadó a kölcsönzést a profil oldalon visszavonhatja.',
      '  - Várólista: csak teltházas (elfogyott) mérkőzésre lehet jelentkezni, lezárult vagy lemondott mérkőzésre nem; mérkőzésenként egy aktív jelentkezés lehet, megadható darabszám és szektor-preferencia.',
      `    Ha hely szabadul fel, a sorban következőt értesítjük, aki ${r.waitlistClaimMinutes} percig erősítheti meg; ha nem teszi, a hely a következőé.`,
      '  - Lemondás, visszatérítés: a portálon nincs önkiszolgáló jegylemondás vagy visszatérítés-kérés. Automatikus visszatérítés csak akkor történik, ha a fizetés után a hely vagy a bérlet mégsem adható ki. Más visszatérítési vagy lemondási szabályt nem ismersz: ezt ne találd ki, hanem irányíts a jegy@kte.hu címre.',
    ].join('\n');
  }

  private formatLoyalty(l: ChatbotLoyaltySnapshot): string {
    const fmt = (n: number) => n.toLocaleString('hu-HU');
    const tiers = l.tiers
      .map((t, i) => {
        const next = l.tiers[i + 1];
        const range = next
          ? `${fmt(t.minPoints)}–${fmt(next.minPoints - 1)} pont`
          : `${fmt(t.minPoints)} pont felett`;
        return `  - ${t.label}: ${range}, jegykedvezmény: ${t.discountPercent}%`;
      })
      .join('\n');
    const e = l.earning;
    return [
      'Hűségprogram szabályai:',
      tiers,
      `  Pontszerzés: regisztráció +${e.registration}, profil kitöltése +${e.profileCompletion}, jegyvásárlás +${e.perTicket} jegyenként, bérletvásárlás +${e.seasonPass}, bérletkölcsönzés +${e.passLoan}.`,
      `  Szezon végén (június 30.) a pontegyenleg ${l.carryoverPercent}%-a megmarad, a többi lejár; a szint ezután újraszámolódik.`,
    ].join('\n');
  }

  private formatSectors(match: ChatbotMatchSnapshot): string {
    // `sectors` is absent in snapshots cached before it existed.
    if (!match.sectors || match.sectors.length === 0) {
      return 'szektoronkénti adat nem elérhető';
    }
    return match.sectors
      .map((s) => {
        const name = s.name ?? `${s.section} szektor`;
        if (s.away) {
          // The away section: described so questions about it can be answered, but with no
          // price or seat counts, so there is nothing to recommend or quote for sale.
          return `${name}: vendégszektor, csak vendégszurkolóknak; a portálon nem vásárolható, bérlet sem váltható rá`;
        }
        const gate = s.gate ? `; bejárat: ${s.gate}. kapu` : '';
        return `${name}: jegyár ${this.formatSectorPrice(s)}; helyek (mozgó adat): szabad ${s.free}, eladott ${s.sold}, zárolt ${s.locked}, összes ${s.total}; fedettség: ${this.formatCoverage(s)}${gate}`;
      })
      .join('; ');
  }

  /** Only an explicit true/false is stated; a missing value is "unknown", never "open". */
  private formatCoverage(s: ChatbotSectorSnapshot): string {
    if (s.covered === true) {
      return 'fedett';
    }
    if (s.covered === false) {
      return 'nem fedett';
    }
    return 'nem elérhető';
  }

  private formatSectorPrice(s: ChatbotSectorSnapshot): string {
    // Snapshots cached before prices existed have no price fields.
    if (typeof s.minPrice !== 'number' || typeof s.maxPrice !== 'number') {
      return 'nem elérhető';
    }
    const fmt = (n: number) => `${n.toLocaleString('hu-HU')} Ft`;
    return s.minPrice === s.maxPrice ? fmt(s.minPrice) : `${fmt(s.minPrice)}–${fmt(s.maxPrice)}`;
  }
}
