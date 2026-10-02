export const MAX_LEVEL = 10;

/** Total XP needed to reach `level` (WC3-like quadratic curve, scaled down). */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * (level + 2);
}
