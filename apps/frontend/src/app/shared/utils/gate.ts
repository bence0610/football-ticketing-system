/**
 * "3-as kapu": a gate number in words a person can follow. The Hungarian
 * suffix follows the number's sound: 1, 2 and 4 take -es, 3 takes -as.
 * Returns null when the gate is unknown, so nothing is claimed.
 */
const SUFFIX: Readonly<Record<number, string>> = { 1: 'es', 2: 'es', 3: 'as', 4: 'es' };

export function gateLabel(gate: number | null | undefined): string | null {
  return gate && SUFFIX[gate] ? `${gate}-${SUFFIX[gate]} kapu` : null;
}

/** The four gates, for the steward's "this is my gate" picker. */
export const GATES: readonly number[] = [1, 2, 3, 4];
