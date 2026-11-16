import { CLASS_WEIGHT, DEMO_EMAIL_DOMAIN } from './users';
import type { DemoLoan, DemoPass, DemoUser, LoanOutcome } from './model';
import type { MatchPlan } from './schedule';
import type { Rng } from './rng';
import { DAY_MS } from './time';

type PassChoice = 'kolcsonzo' | 'berletes' | 'crowd';
type BorrowerChoice = 'kolcsonvevo' | 'meghivott' | 'crowd' | 'unregistered';

interface LoanPlan {
  pass: PassChoice;
  matchKey: string;
  outcome: LoanOutcome;
  borrower: BorrowerChoice;
}

/**
 * Ten loans in every state the application can produce. `revoked` is left out on purpose:
 * its own enum comment says no code path sets it (a withdrawn loan is `cancelled`).
 * A lent entry replaces the owner's: no pass entry exists for that match and seat.
 */
const PLAN: readonly LoanPlan[] = [
  { pass: 'kolcsonzo', matchKey: 'cur:r07', outcome: 'used', borrower: 'kolcsonvevo' },
  { pass: 'crowd', matchKey: 'cur:r09', outcome: 'used', borrower: 'crowd' },
  { pass: 'crowd', matchKey: 'cur:r03', outcome: 'used', borrower: 'crowd' },
  { pass: 'crowd', matchKey: 'cur:r05', outcome: 'completed', borrower: 'crowd' },
  { pass: 'crowd', matchKey: 'cur:r09', outcome: 'expired', borrower: 'unregistered' },
  { pass: 'crowd', matchKey: 'cur:r19', outcome: 'cancelled_pending', borrower: 'crowd' },
  { pass: 'crowd', matchKey: 'cur:r17', outcome: 'cancelled_accepted', borrower: 'crowd' },
  { pass: 'crowd', matchKey: 'cur:r17', outcome: 'accepted', borrower: 'crowd' },
  { pass: 'berletes', matchKey: 'cur:r17', outcome: 'pending', borrower: 'meghivott' },
  { pass: 'crowd', matchKey: 'cur:r19', outcome: 'pending', borrower: 'unregistered' },
];

export function planLoans(
  users: readonly DemoUser[],
  currentPasses: readonly DemoPass[],
  matches: ReadonlyMap<string, MatchPlan>,
  rng: Rng,
): DemoLoan[] {
  const byKey = new Map(users.filter((u) => u.key).map((u) => [u.key as string, u]));
  const passByHolder = new Map(
    currentPasses.filter((p) => p.holderId).map((p) => [p.holderId as string, p]),
  );
  const userById = new Map(users.map((u) => [u.id, u]));

  // Lenders for the crowd loans: passes bought and held by the same account, earliest first
  // (an invitation cannot be sent from a pass that does not exist yet).
  const ownCrowdPasses = currentPasses
    .filter((p) => p.holderId && p.buyerId === p.holderId && !userById.get(p.holderId)?.key)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const borrowers = users.filter(
    (u) =>
      !u.key &&
      !u.passHolder &&
      (u.fanClass === 'casual' || u.fanClass === 'frequent') &&
      CLASS_WEIGHT[u.fanClass] > 0,
  );
  rng.shuffle(borrowers);
  let nextPass = 0;
  let nextBorrower = 0;
  let unregistered = 0;

  const loans: DemoLoan[] = [];
  for (const p of PLAN) {
    const match = matches.get(p.matchKey);
    if (!match) throw new Error(`Loan plan refers to a match that does not exist: ${p.matchKey}`);
    const pass =
      p.pass === 'crowd'
        ? ownCrowdPasses[nextPass++]
        : (passByHolder.get((byKey.get(p.pass) as DemoUser).id) as DemoPass);
    if (!pass) throw new Error('Not enough own-holder passes for the planned loans.');
    const lender = userById.get(pass.holderId as string) as DemoUser;

    let borrowerId: string | null = null;
    let borrowerEmail: string;
    if (p.borrower === 'unregistered') {
      unregistered += 1;
      borrowerEmail = `vendeg.meghivott${unregistered}@${DEMO_EMAIL_DOMAIN}`;
    } else {
      const borrower =
        p.borrower === 'crowd'
          ? borrowers
              .slice(nextBorrower)
              .find((b) => b.createdAt.getTime() < match.kickoffAt.getTime() - 15 * DAY_MS)
          : (byKey.get(p.borrower) as DemoUser);
      if (!borrower) throw new Error('Not enough borrowers for the planned loans.');
      if (p.borrower === 'crowd') nextBorrower = borrowers.indexOf(borrower) + 1;
      borrowerId = borrower.id;
      borrowerEmail = borrower.email;
    }
    loans.push({
      id: rng.uuid(),
      pass,
      matchKey: p.matchKey,
      lenderId: lender.id,
      borrowerId,
      borrowerEmail,
      outcome: p.outcome,
    });
  }
  return loans;
}
