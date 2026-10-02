/**
 * Combat tuning in one place.
 *
 * Target feel: a creep of the hero's level dies in 2-3 auto attacks, and a melee creep running at
 * the archer from max range eats 2-3 arrows before it arrives (range 96px, creeps ~30px/s,
 * one arrow per 1.1s).
 */

export function heroDamage(level: number): [number, number] {
  return [22 + 4 * (level - 1), 28 + 4 * (level - 1)];
}

export function heroAvgDamage(level: number): number {
  const [a, b] = heroDamage(level);
  return (a + b) / 2;
}

export type CreepKind = 'skeleton' | 'boar' | 'alphaBoar';

/** How many average same-level hero arrows each creep takes to kill. */
const HITS_TO_KILL: Record<CreepKind, number> = { skeleton: 2.4, boar: 2.8, alphaBoar: 6.5 };

export function creepMaxHp(kind: CreepKind, level: number): number {
  return Math.round(HITS_TO_KILL[kind] * heroAvgDamage(level));
}

export function creepDamage(base: [number, number], level: number): [number, number] {
  const k = 1 + 0.15 * (level - 1);
  return [Math.round(base[0] * k), Math.round(base[1] * k)];
}

export function creepXp(kind: CreepKind, level: number): number {
  return Math.round((kind === 'alphaBoar' ? 2.5 : 1) * (20 + 15 * level));
}

/** Chance a dying creep drops a potion. */
export const CREEP_POTION_DROP = 0.15;
