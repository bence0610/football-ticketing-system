import { registerAs } from '@nestjs/config';

export interface LoyaltyConfig {
  registrationPoints: number;
  profileCompletionPoints: number;
  /** Points for entering a match, once per person per match (LOYALTY_ATTENDANCE_POINTS). */
  attendancePoints: number;
  seasonPassPoints: number;
  passLoanPoints: number;
  carryoverPercent: number;
}

export default registerAs(
  'loyalty',
  (): LoyaltyConfig => ({
    registrationPoints: parseInt(process.env.LOYALTY_REGISTRATION_POINTS ?? '100', 10),
    profileCompletionPoints: parseInt(process.env.LOYALTY_PROFILE_COMPLETION_POINTS ?? '50', 10),
    // LOYALTY_TICKET_POINTS_PER_TICKET is the old name of the same setting: still read when the
    // new one is not set.
    attendancePoints: parseInt(
      process.env.LOYALTY_ATTENDANCE_POINTS ?? process.env.LOYALTY_TICKET_POINTS_PER_TICKET ?? '50',
      10,
    ),
    seasonPassPoints: parseInt(process.env.LOYALTY_SEASON_PASS_POINTS ?? '500', 10),
    passLoanPoints: parseInt(process.env.LOYALTY_PASS_LOAN_POINTS ?? '25', 10),
    carryoverPercent: parseInt(process.env.LOYALTY_CARRYOVER_PERCENT ?? '70', 10),
  }),
);
