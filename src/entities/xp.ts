import { creepXp } from './balance';

export const MAX_LEVEL = 20;

/**
 * Kills of same-level creeps needed to go from `level` to the next: 9 at first, growing by 1.5 a
 * level (about 36 at level 19). Quests add chunks on top, so the real pace is a bit quicker.
 */
export function killsToLevel(level: number): number {
  return 9 + 1.5 * (level - 1);
}

const TOTALS: number[] = [0, 0];
for (let l = 1; l < MAX_LEVEL; l++) TOTALS[l + 1] = TOTALS[l] + Math.round((killsToLevel(l) * creepXp('skeleton', l)) / 10) * 10;

/** Total XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > MAX_LEVEL) return TOTALS[MAX_LEVEL] + 1e9;
  return TOTALS[level];
}
