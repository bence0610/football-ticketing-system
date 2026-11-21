import { registerAs } from '@nestjs/config';

export interface GateConfig {
  /** A ticket can be scanned from this many hours BEFORE kickoff... */
  opensHoursBefore: number;
  /** ...until this many hours AFTER it (the loan sweep and the match-finish job wait longer). */
  closesHoursAfter: number;
}

export default registerAs(
  'gate',
  (): GateConfig => ({
    opensHoursBefore: parseFloat(process.env.GATE_OPENS_HOURS_BEFORE ?? '3'),
    closesHoursAfter: parseFloat(process.env.GATE_CLOSES_HOURS_AFTER ?? '4'),
  }),
);

/** The defaults, for code that is built without the configuration (tests). */
export const DEFAULT_GATE_CONFIG: GateConfig = { opensHoursBefore: 3, closesHoursAfter: 4 };

/**
 * Where `now` stands against the scan window of a match: 'open', 'early' (before the gate opens)
 * or 'late' (after it closed). THE one rule for "can a ticket for this match be scanned now".
 */
export function scanWindowState(
  kickoffAt: Date,
  now: Date,
  gate: GateConfig,
): 'open' | 'early' | 'late' {
  const kickoff = new Date(kickoffAt).getTime();
  if (now.getTime() < kickoff - gate.opensHoursBefore * 3_600_000) return 'early';
  if (now.getTime() > kickoff + gate.closesHoursAfter * 3_600_000) return 'late';
  return 'open';
}
