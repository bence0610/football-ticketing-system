import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config';
import { Match, SeasonPass, Ticket, TicketSource, TicketStatus } from '../../database/entities';
import { SOLD_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { PASS_REVENUE_STATUSES, passRevenueByTier, sumTiers } from './season-pass-revenue';
import {
  RevenueByMatchDto,
  RevenueDailyPointDto,
  RevenueStatsDto,
  RevenueSummaryDto,
  SeasonPassDailyPointDto,
  SeasonPassRevenueDto,
} from './dto/revenue-stats.dto';

// Paid tickets, scanned or not: an expired ticket's money was received (see SOLD_TICKET_STATUSES).
const REVENUE_STATUSES: TicketStatus[] = [...SOLD_TICKET_STATUSES];

@Injectable()
export class AdminRevenueService {
  constructor(
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(SeasonPass) private readonly passRepository: Repository<SeasonPass>,
    configService: ConfigService,
  ) {
    this.homeTeamName = configService.getOrThrow<AppConfig>('app').homeTeamName;
  }

  /**
   * Tickets are sold only for the club's home matches. Every ticket figure below joins the
   * match and keeps the home ones, so an away match can never add to revenue or ticket counts.
   */
  private readonly homeTeamName: string;

  /**
   * Aggregates revenue stats for the admin dashboard. `summary`, `daily` and
   * `byMatch` are bound to PAID + USED SINGLE tickets (pending and refunded
   * entries excluded; pass and loan entries carry no price of their own).
   * Season-pass revenue is reported in `seasonPasses`, separately: a pass is one
   * payment for a whole season and is not allocated to matches.
   */
  async getStats(daysWindow = 30): Promise<RevenueStatsDto> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(todayStart.getTime() - (daysWindow - 1) * 86_400_000);

    const [todayAgg, monthAgg, daily, byMatch, seasonPasses] = await Promise.all([
      this.aggregateBetween(todayStart, endOfDay(now)),
      this.aggregateBetween(monthStart, endOfDay(now)),
      this.dailySeries(windowStart, endOfDay(now)),
      this.byMatch(10),
      this.seasonPassRevenue(todayStart, monthStart, windowStart, now),
    ]);

    const summary: RevenueSummaryDto = {
      todayRevenue: todayAgg.amount,
      monthRevenue: monthAgg.amount,
      todayTicketCount: todayAgg.ticketCount,
      monthTicketCount: monthAgg.ticketCount,
      topMatch: byMatch[0],
    };

    return { summary, daily, byMatch, seasonPasses };
  }

  private async seasonPassRevenue(
    todayStart: Date,
    monthStart: Date,
    windowStart: Date,
    now: Date,
  ): Promise<SeasonPassRevenueDto> {
    const [today, month, byTier, dailyRows] = await Promise.all([
      passRevenueByTier(this.passRepository, {
        createdBetween: { from: todayStart, to: endOfDay(now) },
      }),
      passRevenueByTier(this.passRepository, {
        createdBetween: { from: monthStart, to: endOfDay(now) },
      }),
      passRevenueByTier(this.passRepository, {}),
      this.passRepository
        .createQueryBuilder('sp')
        .select("DATE_FORMAT(sp.createdAt, '%Y-%m-%d')", 'date')
        .addSelect('COALESCE(SUM(sp.pricePaid), 0)', 'amount')
        .addSelect('COUNT(sp.id)', 'passCount')
        .where('sp.status IN (:...statuses)', { statuses: PASS_REVENUE_STATUSES })
        .andWhere('sp.createdAt BETWEEN :from AND :to', { from: windowStart, to: endOfDay(now) })
        .groupBy('date')
        .getRawMany<{ date: string; amount: string | number; passCount: string | number }>(),
    ]);
    const byDate = new Map(dailyRows.map((r) => [r.date, r]));
    const daily: SeasonPassDailyPointDto[] = [];
    const cursor = new Date(windowStart);
    while (cursor <= endOfDay(now)) {
      const key = formatDate(cursor);
      const row = byDate.get(key);
      daily.push({
        date: key,
        amount: row ? Math.round(Number(row.amount)) : 0,
        passCount: row ? Number(row.passCount) : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    const t = sumTiers(today);
    const m = sumTiers(month);
    return {
      todayRevenue: t.revenue,
      monthRevenue: m.revenue,
      todayPassCount: t.passCount,
      monthPassCount: m.passCount,
      daily,
      byTier,
    };
  }

  private async aggregateBetween(
    from: Date,
    to: Date,
  ): Promise<{ amount: number; ticketCount: number }> {
    const row = await this.ticketRepository
      .createQueryBuilder('t')
      .innerJoin(Match, 'm', 'm.id = t.matchId')
      .select('COALESCE(SUM(t.pricePaid), 0)', 'amount')
      .addSelect('COUNT(t.id)', 'ticketCount')
      .where('t.status IN (:...statuses)', { statuses: REVENUE_STATUSES })
      .andWhere('t.source = :single', { single: TicketSource.SINGLE })
      .andWhere('m.homeTeam = :home', { home: this.homeTeamName })
      .andWhere('t.createdAt BETWEEN :from AND :to', { from, to })
      .getRawOne<{ amount: string | number; ticketCount: string | number }>();
    return {
      amount: Math.round(Number(row?.amount ?? 0)),
      ticketCount: Number(row?.ticketCount ?? 0),
    };
  }

  private async dailySeries(from: Date, to: Date): Promise<RevenueDailyPointDto[]> {
    const rows = await this.ticketRepository
      .createQueryBuilder('t')
      .innerJoin(Match, 'm', 'm.id = t.matchId')
      .select("DATE_FORMAT(t.createdAt, '%Y-%m-%d')", 'date')
      .addSelect('COALESCE(SUM(t.pricePaid), 0)', 'amount')
      .addSelect('COUNT(t.id)', 'ticketCount')
      .where('t.status IN (:...statuses)', { statuses: REVENUE_STATUSES })
      .andWhere('t.source = :single', { single: TicketSource.SINGLE })
      .andWhere('m.homeTeam = :home', { home: this.homeTeamName })
      .andWhere('t.createdAt BETWEEN :from AND :to', { from, to })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; amount: string | number; ticketCount: string | number }>();

    const byDate = new Map<string, RevenueDailyPointDto>();
    for (const row of rows) {
      byDate.set(row.date, {
        date: row.date,
        amount: Math.round(Number(row.amount)),
        ticketCount: Number(row.ticketCount),
      });
    }
    // Fill missing days with zero so the chart line is continuous.
    const filled: RevenueDailyPointDto[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const key = formatDate(cursor);
      filled.push(byDate.get(key) ?? { date: key, amount: 0, ticketCount: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return filled;
  }

  private async byMatch(limit: number): Promise<RevenueByMatchDto[]> {
    const rows = await this.ticketRepository
      .createQueryBuilder('t')
      .innerJoin(Match, 'm', 'm.id = t.matchId')
      .select('t.matchId', 'matchId')
      .addSelect('m.homeTeam', 'homeTeam')
      .addSelect('m.awayTeam', 'awayTeam')
      .addSelect('m.kickoffAt', 'kickoffAt')
      .addSelect('COUNT(t.id)', 'ticketCount')
      .addSelect('COALESCE(SUM(t.pricePaid), 0)', 'revenue')
      .where('t.status IN (:...statuses)', { statuses: REVENUE_STATUSES })
      .andWhere('t.source = :single', { single: TicketSource.SINGLE })
      .andWhere('m.homeTeam = :home', { home: this.homeTeamName })
      .groupBy('t.matchId')
      .addGroupBy('m.homeTeam')
      .addGroupBy('m.awayTeam')
      .addGroupBy('m.kickoffAt')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany<{
        matchId: string;
        homeTeam: string;
        awayTeam: string;
        kickoffAt: Date;
        ticketCount: string | number;
        revenue: string | number;
      }>();

    return rows.map((row) => ({
      matchId: row.matchId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffAt: new Date(row.kickoffAt).toISOString(),
      ticketCount: Number(row.ticketCount),
      revenue: Math.round(Number(row.revenue)),
    }));
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
