/**
 * "3-as kapu": the gate a sector is served by, in words a person can follow.
 * The Hungarian suffix follows the number's sound: 1, 2, 4 take -es, 3 takes -as.
 */
const SUFFIX: Readonly<Record<number, string>> = { 1: 'es', 2: 'es', 3: 'as', 4: 'es' };

export function gateLabel(gate: number | null | undefined): string | undefined {
  return gate && SUFFIX[gate] ? `${gate}-${SUFFIX[gate]} kapu` : undefined;
}
