import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotContextSnapshot } from './chatbot-context.service';
import { TIER_DEFINITIONS } from '../loyalty/loyalty.constants';
import { ChatbotService } from './chatbot.service';

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    beta: { promptCaching: { messages: { create: (...a: unknown[]) => create(...a) } } },
  })),
}));

const SNAPSHOT: ChatbotContextSnapshot = {
  generatedAt: '2030-01-01T10:00:00.000Z',
  seasonPass: {
    seasonLabel: '2026/2027',
    validFrom: '2026-08-01',
    validUntil: '2027-06-30',
    prices: [
      { section: 'VIP', sectionName: 'VIP szektor', price: 45000 },
      { section: 'B', sectionName: 'B szektor', price: 30000 },
    ],
  },
  rules: {
    seatHoldMinutes: 5,
    maxSeatsPerOrder: 6,
    loanInvitationTtlHours: 72,
    waitlistClaimMinutes: 10,
  },
  loyalty: {
    tiers: TIER_DEFINITIONS.map((t) => ({
      tier: t.tier,
      label: t.label,
      minPoints: t.minPoints,
      discountPercent: t.discountPercent,
    })),
    earning: {
      registration: 100,
      profileCompletion: 50,
      perTicket: 50,
      seasonPass: 500,
      passLoan: 25,
    },
    carryoverPercent: 50,
  },
  upcomingMatches: [
    {
      id: 'm1',
      isHome: true,
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Ferencváros',
      competition: 'NB I',
      venue: 'Széktói Stadion',
      kickoffAt: '2030-01-05T17:00:00.000Z',
      status: 'on_sale',
      basePrice: 5000,
      capacity: 100,
      soldSeats: 40,
      availableSeats: 60,
      occupancyPercent: 40,
      description: 'Rangadó a bajnokságban.',
      weather: {
        summary: 'Gyenge eső',
        temperatureCelsius: 12,
        precipitationProbabilityPercent: 65,
        rainWarning: true,
      },
      sectors: [
        {
          section: 'B',
          total: 50,
          free: 31,
          sold: 15,
          locked: 4,
          minPrice: 5000,
          maxPrice: 5000,
          covered: true,
        },
        {
          section: 'A',
          total: 100,
          free: 40,
          sold: 60,
          locked: 0,
          minPrice: 7500,
          maxPrice: 7500,
          covered: false,
        },
        {
          section: 'VIP',
          total: 24,
          free: 10,
          sold: 14,
          locked: 0,
          minPrice: 12500,
          maxPrice: 15000,
          covered: null, // no data for this sector
        },
      ],
    },
    {
      id: 'm2',
      isHome: false,
      homeTeam: 'Újpest',
      awayTeam: 'Kecskeméti TE',
      competition: 'NB I',
      venue: 'Szusza Ferenc Stadion',
      kickoffAt: '2030-01-12T17:00:00.000Z',
      status: 'scheduled',
      basePrice: 4000,
      capacity: 100,
      soldSeats: 0,
      availableSeats: 100,
      occupancyPercent: 0,
      description: null,
      weather: null,
      sectors: null,
    },
  ],
};

describe('ChatbotService', () => {
  const ALICE = 'user:alice';
  const MALLORY = 'anon:mallory';
  let owners: Map<string, string>;
  let history: Record<string, jest.Mock>;
  let service: ChatbotService;

  const okResponse = (text = 'Szia!') => ({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  beforeEach(() => {
    create.mockReset();
    owners = new Map([['conv-alice', ALICE]]);
    history = {
      load: jest.fn(async () => [{ role: 'user', content: 'Alice titka', createdAt: 't' }]),
      append: jest.fn(async () => undefined),
      getOwner: jest.fn(async (id: string) => owners.get(id) ?? null),
      claim: jest.fn(async (id: string, owner: string) => void owners.set(id, owner)),
      touchOwner: jest.fn(async () => undefined),
    };
    const config = {
      getOrThrow: () => ({ apiKey: '', model: 'test-model', maxTokens: 100 }),
    } as unknown as ConfigService;
    service = new ChatbotService(
      config,
      { getUpcomingMatchesSnapshot: jest.fn(async () => SNAPSHOT) } as never,
      history as never,
    );
  });

  describe('Anthropic failure', () => {
    it('maps an upstream error (e.g. 529 overloaded) to a 503 with the Hungarian message', async () => {
      create.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
      const err = await service.sendMessage({ message: 'Szia', owner: ALICE }).catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getStatus()).toBe(503);
      expect(err.message).toBe(
        'A chatbot szolgáltatás jelenleg nem elérhető. Próbáld újra később.',
      );
    });

    it.each([
      [401, 'AUTHENTICATION'],
      [404, 'UNKNOWN MODEL'],
      [429, 'RATE LIMIT'],
    ])(
      'logs a distinct diagnosis for %s while the user message stays the same',
      async (status, label) => {
        const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        create.mockRejectedValue(Object.assign(new Error('x'), { status }));
        const err = await service.sendMessage({ message: 'Szia', owner: ALICE }).catch((e) => e);
        expect(err.message).toBe(
          'A chatbot szolgáltatás jelenleg nem elérhető. Próbáld újra később.',
        );
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(label));
        if (status === 404) {
          expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('test-model'));
        }
        logSpy.mockRestore();
      },
    );

    it('persists nothing when the upstream call failed', async () => {
      create.mockRejectedValue(new Error('boom'));
      await service.sendMessage({ message: 'Szia', owner: ALICE }).catch(() => undefined);
      expect(history.append).not.toHaveBeenCalled();
      expect(history.claim).not.toHaveBeenCalled();
    });
  });

  describe('conversation ownership', () => {
    it("rejects someone else's conversationId with 403, without loading history or calling the model", async () => {
      const err = await service
        .sendMessage({ message: 'mit írt Alice?', conversationId: 'conv-alice', owner: MALLORY })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(history.load).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(history.append).not.toHaveBeenCalled();
    });

    it('rejects a guessable id the server never issued with 404 instead of adopting it', async () => {
      await expect(
        service.sendMessage({ message: 'x', conversationId: '1', owner: MALLORY }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(history.claim).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('lets the owner continue and loads the history', async () => {
      create.mockResolvedValue(okResponse());
      const out = await service.sendMessage({
        message: 'és most?',
        conversationId: 'conv-alice',
        owner: ALICE,
      });
      expect(out.conversationId).toBe('conv-alice');
      expect(history.load).toHaveBeenCalledWith('conv-alice');
      expect(history.touchOwner).toHaveBeenCalledWith('conv-alice');
    });

    it('issues a server-side id for a new conversation and binds it to the caller', async () => {
      create.mockResolvedValue(okResponse());
      const out = await service.sendMessage({ message: 'Szia', owner: MALLORY });
      expect(out.conversationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(history.claim).toHaveBeenCalledWith(out.conversationId, MALLORY);
    });

    it('fails closed (503) when ownership cannot be verified', async () => {
      history.getOwner.mockRejectedValue(new Error('redis down'));
      await expect(
        service.sendMessage({ message: 'x', conversationId: 'conv-alice', owner: ALICE }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('prompt', () => {
    it('forbids numbers outside the snapshot and shows isHome and sector counts', async () => {
      create.mockResolvedValue(okResponse());
      await service.sendMessage({ message: 'hány hely van a B szektorban?', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      expect(system[0].text).toContain('CSAK akkor mondhatsz');
      expect(system[0].text).toContain('nem tudod');
      expect(system[1].text).toContain(
        'B szektor: jegyár 5000 Ft; helyek (mozgó adat): szabad 31, eladott 15, zárolt 4, összes 50',
      );
      expect(system[1].text).toContain('hazai mérkőzés');
      expect(system[1].text).toContain('idegenbeli mérkőzés');
      expect(system[1].text).toContain('szektoronkénti adat nem elérhető');
    });

    it('answers "which sector is covered?" from the snapshot: covered, not covered, or unknown', async () => {
      create.mockResolvedValue(okResponse());
      await service.sendMessage({ message: 'melyik szektor fedett?', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };

      // the data the answer is built from, in the snapshot the model reads
      expect(system[1].text).toContain(
        'B szektor: jegyár 5000 Ft; helyek (mozgó adat): szabad 31, eladott 15, zárolt 4, összes 50; fedettség: fedett',
      );
      expect(system[1].text).toContain(
        'A szektor: jegyár 7500 Ft; helyek (mozgó adat): szabad 40, eladott 60, zárolt 0, összes 100; fedettség: nem fedett',
      );
      // a sector without data is "unknown", never "open"
      expect(system[1].text.replace(/\s/g, ' ')).toMatch(/VIP szektor: .*fedettség: nem elérhető/);

      // and the rules tell the model to answer it directly rather than refuse
      expect(system[0].text).toContain('melyik szektor fedett?');
      expect(system[0].text).toContain('állandó adat');
    });

    it('shows sector prices (single and range) and limits the staleness caveat to availability', async () => {
      create.mockResolvedValue(okResponse());
      await service.sendMessage({ message: 'mennyibe kerül a VIP jegy?', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      // hu-HU groups with a no-break space; compare whitespace-insensitively.
      expect(system[1].text.replace(/\s/g, ' ')).toContain(
        'VIP szektor: jegyár 12 500 Ft–15 000 Ft',
      );
      const header = system[0].text;
      expect(header).toContain('CSAK akkor jelezd');
      expect(header).toContain('Az árakra');
      expect(header).not.toContain('hely- és szektoradatok');
    });

    it('describes the away section without a price or seat counts, and never as something to buy', () => {
      const away = new ChatbotService(
        { getOrThrow: () => ({ apiKey: '', model: 'test-model', maxTokens: 100 }) } as never,
        {} as never,
        {} as never,
      );
      const text = (
        away as unknown as {
          formatSectors: (m: { sectors: unknown[] }) => string;
        }
      ).formatSectors({
        sectors: [
          {
            section: 'VENDÉG',
            name: 'Vendég szektor',
            away: true,
            gate: 3,
            total: 280,
            free: 0,
            sold: 0,
            locked: 0,
            minPrice: 3500,
            maxPrice: 3500,
            covered: false,
          },
          {
            section: 'F',
            name: 'F szektor',
            gate: 1,
            total: 234,
            free: 200,
            sold: 34,
            locked: 0,
            minPrice: 3500,
            maxPrice: 3500,
            covered: false,
          },
        ],
      });

      expect(text).toContain('Vendég szektor: vendégszektor, csak vendégszurkolóknak');
      expect(text).toContain('a portálon nem vásárolható, bérlet sem váltható rá');
      // no price, no free-seat count and no gate for the section nobody can buy
      expect(text.split('; ')[0]).not.toMatch(/jegyár|szabad|kapu/);
      // a sellable sector shows its display name and its gate
      expect(text).toContain('F szektor: jegyár');
      expect(text).toContain('bejárat: 1. kapu');
    });

    it('says a price is unavailable for sectors cached before prices existed', async () => {
      create.mockResolvedValue(okResponse());
      const legacy = new ChatbotService(
        { getOrThrow: () => ({ apiKey: '', model: 'test-model', maxTokens: 100 }) } as never,
        {
          getUpcomingMatchesSnapshot: jest.fn(async () => ({
            ...SNAPSHOT,
            upcomingMatches: [
              {
                ...SNAPSHOT.upcomingMatches[0],
                sectors: [{ section: 'B', total: 50, free: 31, sold: 15, locked: 4 }],
              },
            ],
          })),
        } as never,
        history as never,
      );
      await legacy.sendMessage({ message: 'x', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      expect(system[1].text).toContain('B szektor: jegyár nem elérhető');
    });

    it('puts season-pass prices, config-derived rules, weather and the refund statement into the prompt', async () => {
      create.mockResolvedValue(okResponse());
      await service.sendMessage({ message: 'mennyibe kerül a bérlet?', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      const text = system[1].text.replace(/\s/g, ' ');
      expect(text).toContain('VIP szektor: 45 000 Ft');
      // The window is stated as inclusive of both days, read in the stadium's timezone.
      expect(text).toContain('2026-08-01 első napjától 2027-06-30 utolsó napjának végéig');
      expect(text).toContain('az első és az utolsó napon játszott mérkőzés is lefedett');
      expect(text).toContain('Europe/Budapest');
      expect(text).toContain('5 percig tartjuk fenn');
      expect(text).toContain('legfeljebb 6 jegy');
      expect(text).toContain('A meghívó 72 óráig érvényes');
      expect(text).toContain('10 percig erősítheti meg');
      expect(text).toContain('Gyenge eső, 12 °C, csapadék valószínűsége 65%');
      expect(text).toContain('Leírás: Rangadó a bajnokságban.');
      expect(text).toContain('nincs önkiszolgáló jegylemondás');
      expect(text).toContain('ne találd ki');
      // The second match has no forecast.
      expect(text).toContain('Időjárás-előrejelzés a kezdésre: nem elérhető');
    });

    it('tells the model not to quote pass prices when the price list is unavailable', async () => {
      create.mockResolvedValue(okResponse());
      const noPrices = new ChatbotService(
        { getOrThrow: () => ({ apiKey: '', model: 'test-model', maxTokens: 100 }) } as never,
        {
          getUpcomingMatchesSnapshot: jest.fn(async () => ({ ...SNAPSHOT, seasonPass: null })),
        } as never,
        history as never,
      );
      await noPrices.sendMessage({ message: 'x', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      expect(system[1].text).toContain('az árlista jelenleg nem elérhető');
    });

    it('puts the loyalty rules into the prompt, derived from the real tier table', async () => {
      create.mockResolvedValue(okResponse());
      await service.sendMessage({ message: 'Hogyan működik a hűségprogram?', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      const text = system[1].text;
      expect(text).toContain('Hűségprogram szabályai');
      for (const t of TIER_DEFINITIONS) {
        expect(text).toContain(t.label);
        expect(text).toContain(`${t.minPoints.toLocaleString('hu-HU')}`);
        expect(text).toContain(`${t.discountPercent}%`);
      }
      expect(text).toContain('regisztráció +100');
      expect(text).toContain('bérletvásárlás +500');
    });

    it('keeps the loyalty rules even when there is no upcoming match', async () => {
      create.mockResolvedValue(okResponse());
      const empty = new ChatbotService(
        { getOrThrow: () => ({ apiKey: '', model: 'test-model', maxTokens: 100 }) } as never,
        {
          getUpcomingMatchesSnapshot: jest.fn(async () => ({ ...SNAPSHOT, upcomingMatches: [] })),
        } as never,
        history as never,
      );
      await empty.sendMessage({ message: 'x', owner: ALICE });
      const { system } = create.mock.calls[0][0] as { system: { text: string }[] };
      expect(system[1].text).toContain('nincs közelgő mérkőzés');
      expect(system[1].text).toContain('Hűségprogram szabályai');
    });
  });
});
