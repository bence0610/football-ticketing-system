import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotContextSnapshot } from './chatbot-context.service';
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
      sectors: [{ section: 'B', total: 50, free: 31, sold: 15, locked: 4 }],
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
      expect(system[1].text).toContain('B szektor: szabad 31, eladott 15, zárolt 4, összes 50');
      expect(system[1].text).toContain('hazai mérkőzés');
      expect(system[1].text).toContain('idegenbeli mérkőzés');
      expect(system[1].text).toContain('szektoronkénti adat nem elérhető');
    });
  });
});
