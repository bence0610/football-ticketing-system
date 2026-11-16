import { Competition } from '../entities/match.entity';
import { hashString } from './rng';
import type { MatchPlan } from './schedule';

/**
 * The text on the home page card and in the chatbot's match list. Written so that no
 * Hungarian case ending ever has to be added to a club name ("Ellenfél: Ajka"), and so that
 * nothing in it is a checkable claim about a real club.
 */
const GENERIC: readonly string[] = [
  'Fontos hazai pontszerzési lehetőség a tabellán.',
  'Hangulatos bajnoki találkozó a Széktói Stadionban, a felső ív fedett szektoraival.',
  'Családbarát mérkőzés: a gyerekeknek és kísérőiknek is érdemes együtt, egymás mellé ülni.',
  'A hazai szurkolók támogatására ezen a találkozón is nagy szükség lesz.',
];

function flavour(m: MatchPlan): string {
  if (m.opponentKey === 'dvtk') {
    return 'Az NB II egyik legnagyobb szurkolói bázisával rendelkező együttes látogat Kecskemétre, ezért kiemelt érdeklődésre számítunk: érdemes mielőbb jegyet váltani.';
  }
  if (m.opponent.local) {
    return 'Megyei szomszédvári összecsapás: a környékről sokan érkeznek, a jó helyek hamar elfogynak.';
  }
  if (m.opponent.draw >= 1.25) {
    return 'Rangadónak ígérkező mérkőzés, érdemes időben jegyet váltani.';
  }
  return GENERIC[hashString(m.key) % GENERIC.length];
}

function slotNote(m: MatchPlan): string {
  switch (m.slot) {
    case 'midweek':
      return 'Hétközi, esti mérkőzés.';
    case 'fri':
      return 'Péntek esti mérkőzés.';
    case 'sun':
      return 'Vasárnapi mérkőzés.';
    default:
      return '';
  }
}

export function blurbFor(m: MatchPlan): string {
  const who = `Ellenfél: ${m.opponent.name} (${m.opponent.city}).`;
  const head = m.round ? `NB II, ${m.round}. forduló.` : 'NB II bajnoki mérkőzés.';
  if (!m.home) {
    return (
      `${head} Idegenbeli mérkőzés. ${who} ` +
      'A találkozóra a portálon nem értékesítünk jegyet; a vendégszurkolói jegyekről a házigazda klub ad tájékoztatást.'
    );
  }
  if (m.competition === Competition.MAGYAR_KUPA) {
    return (
      `Magyar Kupa, hazai pályán. ${who} Egyetlen mérkőzés dönt a továbbjutásról, ezért különösen számít a szurkolók támogatása. ` +
      slotNote(m)
    ).trim();
  }
  return `${head} ${who} ${flavour(m)} ${slotNote(m)}`.trim();
}
