import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  Ticket,
  TicketStatus,
  User,
} from '../../database/entities';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ProfileDto, ProfileTicketDto, ProfileTicketsDto, UpdateProfileDto } from './dto';

const ACTIVE_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  async count(): Promise<number> {
    return this.userRepository.count();
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Felhasználó nem található.');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      loyaltyTier: user.loyaltyTier,
      loyaltyPoints: user.loyaltyPoints,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getTickets(userId: string, limit = 20, offset = 0): Promise<ProfileTicketsDto> {
    const [rows, total] = await this.ticketRepository.findAndCount({
      where: { userId },
      relations: { match: true, seat: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
      skip: Math.max(offset, 0),
    });

    const now = Date.now();
    const items: ProfileTicketDto[] = rows.map((ticket) => {
      const kickoff = ticket.match?.kickoffAt?.getTime() ?? 0;
      const isActive = ACTIVE_STATUSES.includes(ticket.status) && kickoff >= now;
      return {
        id: ticket.id,
        matchId: ticket.matchId,
        homeTeam: ticket.match?.homeTeam ?? '',
        awayTeam: ticket.match?.awayTeam ?? '',
        kickoffAt: ticket.match?.kickoffAt.toISOString() ?? '',
        venue: ticket.match?.venue ?? '',
        section: ticket.seat?.section ?? '',
        row: ticket.seat?.row ?? '',
        seatNumber: ticket.seat?.number ?? 0,
        category: ticket.seat?.category ?? 'standard',
        status: ticket.status,
        pricePaid: Math.round(Number(ticket.pricePaid)),
        currency: ticket.currency,
        qrCode: ticket.qrCode,
        purchasedAt: ticket.createdAt.toISOString(),
        isActive,
      };
    });

    return { items, total, limit, offset };
  }

  /**
   * Updates a user's profile fields and (when the profile becomes "complete"
   * for the first time) awards the loyalty profile-completion bonus exactly
   * once via LoyaltyService (idempotent through (source, referenceId)).
   *
   * Completion criteria: phoneNumber AND dateOfBirth are present.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Felhasználó nem található.');
    }
    if (dto.firstName !== undefined) {
      user.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      user.lastName = dto.lastName.trim();
    }
    if (dto.phoneNumber !== undefined) {
      user.phoneNumber = dto.phoneNumber.trim() || undefined;
    }
    if (dto.dateOfBirth !== undefined) {
      user.dateOfBirth = dto.dateOfBirth;
    }

    const wasAlreadyComplete = !!user.profileCompletedAt;
    const isNowComplete = Boolean(user.phoneNumber && user.dateOfBirth);

    if (!wasAlreadyComplete && isNowComplete) {
      user.profileCompletedAt = new Date();
    }

    await this.userRepository.save(user);

    if (!wasAlreadyComplete && isNowComplete) {
      try {
        await this.loyaltyService.award({
          userId: user.id,
          type: LoyaltyTransactionType.EARN,
          source: LoyaltyTransactionSource.PROFILE_COMPLETION,
          points: this.loyaltyService.getConfig().profileCompletionPoints,
          referenceId: `profile_completion:${user.id}`,
          description: 'Profil kitöltése jutalom',
        });
      } catch (error) {
        this.logger.error(
          `Profile completion award failed user=${user.id}: ${(error as Error).message}`,
        );
      }
    }

    return this.getProfile(userId);
  }

  /**
   * Awards registration bonus points exactly once per user (idempotent via
   * referenceId). Intended to be called from the registration flow.
   */
  async awardRegistrationBonus(userId: string): Promise<void> {
    try {
      await this.loyaltyService.award({
        userId,
        type: LoyaltyTransactionType.EARN,
        source: LoyaltyTransactionSource.REGISTRATION,
        points: this.loyaltyService.getConfig().registrationPoints,
        referenceId: `registration:${userId}`,
        description: 'Regisztráció bónusz',
      });
    } catch (error) {
      this.logger.error(`Registration bonus failed user=${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Loads many users by id in one query — used by admin / batch flows.
   */
  async findMany(ids: string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.userRepository.find({ where: { id: In(ids) } });
  }
}
