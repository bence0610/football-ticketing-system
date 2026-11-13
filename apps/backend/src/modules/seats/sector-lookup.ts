import { EntityManager } from 'typeorm';
import { Sector } from '../../database/entities';

/**
 * The sectors table as a code -> row map, for DTOs that carry a seat (display
 * name, gate). Tolerant on purpose: if the lookup cannot be made, callers get
 * an empty map and fall back to the bare code and no gate; a ticket must still
 * be listed, scanned and e-mailed.
 */
export async function loadSectorMap(
  manager: EntityManager | undefined,
): Promise<Map<string, Sector>> {
  try {
    if (!manager) return new Map();
    const sectors = await manager.getRepository(Sector).find();
    return new Map((sectors ?? []).map((s) => [s.code, s]));
  } catch {
    return new Map();
  }
}
