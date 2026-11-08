import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * getPaymentStatus feeds the confirmation page: it must only answer the owner,
 * read the amount and points from real records, and tell "processing" from
 * "failed" without ever suggesting a second payment.
 */
describe('PaymentsService.getPaymentStatus', () => {
  const PI = 'pi_3abcDEF123';
  const USER = 'user-1';

  function build(opts: { tickets?: unknown[]; intent?: unknown; retrieveFails?: boolean; points?: number }) {
    const ticketRepository = { find: jest.fn().mockResolvedValue(opts.tickets ?? []) };
    const stripe = {
      paymentIntents: {
        retrieve: opts.retrieveFails
          ? jest.fn().mockRejectedValue(new Error('No such payment_intent'))
          : jest.fn().mockResolvedValue(opts.intent),
      },
    };
    const loyaltyService = { pointsCreditedFor: jest.fn().mockResolvedValue(opts.points ?? 0) };
    const service = Object.assign(Object.create(PaymentsService.prototype), {
      ticketRepository,
      stripe,
      loyaltyService,
    }) as PaymentsService;
    return { service, ticketRepository, stripe, loyaltyService };
  }

  const ticket = (id: string, price: string, seatNumber: number) => ({
    id,
    pricePaid: price,
    currency: 'huf',
    match: {
      id: 'm1',
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Újpest FC',
      venue: 'Széktói Stadion',
      kickoffAt: new Date('2026-11-09T19:00:00Z'),
    },
    seat: { section: 'A', row: '1', number: seatNumber },
  });

  it('does not claim an email until every ticket of the payment is marked as sent', async () => {
    const sent = new Date('2026-11-08T19:00:05.000Z');
    const unsent = ticket('t1', '3500', 1);
    const noneSent = await build({ tickets: [unsent, ticket('t2', '3500', 2)] }).service.getPaymentStatus(PI, USER);
    expect(noneSent.status).toBe('issued');
    expect(noneSent.confirmationEmailSentAt).toBeNull();

    const partly = await build({
      tickets: [{ ...ticket('t1', '3500', 1), confirmationEmailSentAt: sent }, ticket('t2', '3500', 2)],
    }).service.getPaymentStatus(PI, USER);
    expect(partly.confirmationEmailSentAt).toBeNull();

    const all = await build({
      tickets: [
        { ...ticket('t1', '3500', 1), confirmationEmailSentAt: sent },
        { ...ticket('t2', '3500', 2), confirmationEmailSentAt: new Date('2026-11-08T19:00:07.000Z') },
      ],
    }).service.getPaymentStatus(PI, USER);
    expect(all.confirmationEmailSentAt).toBe('2026-11-08T19:00:05.000Z');
  });

  it('reports issued tickets with the amount paid and the points really credited', async () => {
    const { service, loyaltyService } = build({
      tickets: [ticket('t1', '3325.00', 1), ticket('t2', '4987.00', 2)],
      points: 100,
    });
    const status = await service.getPaymentStatus(PI, USER);
    expect(status.status).toBe('issued');
    expect(status.amountPaid).toBe(8312);
    expect(status.pointsCredited).toBe(100);
    expect(status.seats).toHaveLength(2);
    expect(status.match?.awayTeam).toBe('Újpest FC');
    expect(loyaltyService.pointsCreditedFor).toHaveBeenCalledWith(USER, ['ticket:t1', 'ticket:t2']);
  });

  it('only looks at the caller\'s own tickets', async () => {
    const { service, ticketRepository } = build({ tickets: [ticket('t1', '3500', 1)] });
    await service.getPaymentStatus(PI, USER);
    expect(ticketRepository.find.mock.calls[0][0].where).toEqual({ stripePaymentIntentId: PI, userId: USER });
  });

  it('is "processing" while Stripe has the payment but no ticket exists yet', async () => {
    const { service } = build({ intent: { status: 'succeeded', currency: 'huf', metadata: { userId: USER } } });
    const status = await service.getPaymentStatus(PI, USER);
    expect(status.status).toBe('processing');
    expect(status.ticketIds).toEqual([]);
    expect(status.confirmationEmailSentAt).toBeNull();
  });

  it('is "failed" when the payment did not go through', async () => {
    const { service } = build({ intent: { status: 'requires_payment_method', currency: 'huf', metadata: { userId: USER } } });
    expect((await service.getPaymentStatus(PI, USER)).status).toBe('failed');
  });

  it("does not reveal someone else's payment", async () => {
    const { service } = build({ intent: { status: 'succeeded', currency: 'huf', metadata: { userId: 'someone-else' } } });
    await expect(service.getPaymentStatus(PI, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown payment and 400s a malformed id', async () => {
    await expect(build({ retrieveFails: true }).service.getPaymentStatus(PI, USER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({}).service.getPaymentStatus('not-an-id', USER)).rejects.toBeInstanceOf(BadRequestException);
  });
});
