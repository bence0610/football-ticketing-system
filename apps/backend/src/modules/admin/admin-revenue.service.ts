import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Match, Ticket, TicketStatus } from '../../database/entities';
import {
  RevenueByMatchDto,
  RevenueDailyPointDto,
  RevenueStatsDto,
  RevenueSummaryDto,
} from './dto/revenue-stats.dto';

const REVENUE_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.USED];

@Injectable()
export class AdminRevenueService {
  constructor(@InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>) {}

  /**
   * Aggregates revenue stats for the admin dashboard. The dataset is bound
   * to PAID + USED tickets — pending and refunded entries are excluded.
   */
  async getStats(daysWindow = 30): Promise<RevenueStatsDto> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(todayStart.getTime() - (daysWindow - 1) * 86_400_000);

    const [todayAgg, monthAgg, daily, byMatch] = await Promise.all([
      this.aggregateBetween(todayStart, endOfDay(now)),
      this.aggregateBetween(monthStart, endOfDay(now)),
      this.dailySeries(windowStart, endOfDay(now)),
      this.byMatch(10),
    ]);

    const summary: RevenueSummaryDto = {
      todayRevenue: todayAgg.amount,
      monthRevenue: monthAgg.amount,
      todayTicketCount: todayAgg.ticketCount,
      monthTicketCount: monthAgg.ticketCount,
      topMatch: byMatch[0],
    };

    return { summary, daily, byMatch };
  }

  private async aggregateBetween(
    from: Date,
    to: Date,
  ): Promise<{ amount: number; ticketCount: number }> {
    const row = await this.ticketRepository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.pricePaid), 0)', 'amount')
      .addSelect('COUNT(t.id)', 'ticketCount')
      .where('t.status IN (:...statuses)', { statuses: REVENUE_STATUSES })
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
      .select("DATE_FORMAT(t.createdAt, '%Y-%m-%d')", 'date')
      .addSelect('COALESCE(SUM(t.pricePaid), 0)', 'amount')
      .addSelect('COUNT(t.id)', 'ticketCount')
      .where('t.status IN (:...statuses)', { statuses: REVENUE_STATUSES })
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
