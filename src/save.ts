import type { Gear, GearSlot, InvEntry } from './entities/items';

/**
 * Checkpoint saves. The hero's progress is written to localStorage when a save beacon is
 * activated; a new session offers to continue from it. The map seed is saved too, so the
 * same world comes back and the beacon is where you left it.
 */

export const SAVE_KEY = 'ranger-quest.save.v1';

export interface HeroSave {
  level: number;
  xp: number;
  skillPoints: number;
  abilities: Array<{ level: number; autocast?: boolean }>;
  bonus: { hp: number; mana: number; damage: number; speed: number };
  kills: number;
  equipment: Partial<Record<GearSlot, Gear>>;
  bag: (InvEntry | null)[];
}

export interface SaveGame {
  version: 1;
  savedAt: number;
  seed: number;
  /** Tile coords of the beacon that was activated. */
  beacon: { tx: number; ty: number };
  hero: HeroSave;
}

export function loadSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SaveGame;
    return s && s.version === 1 && typeof s.seed === 'number' && s.beacon && s.hero ? s : null;
  } catch {
    return null;
  }
}

export function writeSave(s: SaveGame): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}
