import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sector } from '../../database/entities';

/** Stadium order: upper arc first, then the lower arc, each west to east; unknown sectors last, by code. */
export function compareSectors(
  a: Pick<Sector, 'arc' | 'position' | 'code'>,
  b: Pick<Sector, 'arc' | 'position' | 'code'>,
): number {
  return (
    (a.arc === b.arc ? 0 : a.arc === 'upper' ? -1 : 1) ||
    a.position - b.position ||
    a.code.localeCompare(b.code, 'hu')
  );
}

/** What the rest of the app needs to know about a sector, with nothing hard-coded. */
export interface SectorFacts {
  readonly code: string;
  readonly name: string;
  readonly gate: number | null;
  readonly isAway: boolean;
}

/** Sector code to display name and gate, for DTOs that carry a seat. */
export function factsFor(code: string, sectors: ReadonlyMap<string, Sector>): SectorFacts {
  const sector = sectors.get(code);
  return sector
    ? { code, name: sector.name, gate: sector.gate, isAway: sector.isAway }
    : // no row: say nothing about the gate, and fall back to the bare code
      { code, name: code, gate: null, isAway: false };
}

/**
 * The `sectors` table, the single source of truth for everything about a
 * sector: display name, arc and position, covered flag, gate, price tier, away
 * flag. 19 small rows; read per request rather than cached, so an edit shows up
 * at once.
 */
@Injectable()
export class SectorCatalogueService {
  constructor(@InjectRepository(Sector) private readonly sectorRepository: Repository<Sector>) {}

  /** Stadium order: upper arc first, then the lower arc, each west to east. */
  async all(): Promise<Sector[]> {
    return (await this.sectorRepository.find()).sort(compareSectors);
  }

  async byCode(): Promise<Map<string, Sector>> {
    return new Map((await this.all()).map((s) => [s.code, s]));
  }

  /** code -> 1-based place in the stadium order, for sorting seats. */
  async positions(): Promise<Map<string, number>> {
    return new Map((await this.all()).map((s, i) => [s.code, i + 1]));
  }
}
