/**
 * The Ranger's talent tree (one tree, WoW style): ten talents in four tiers. A talent point comes
 * every second hero level (levels 2, 4, ... 20: ten points against 21 ranks, so you choose). A tier opens once
 * enough points are spent in the tree, and Deadeye also needs Trueshot Aura, drawn as an arrow
 * between them like WoW's prerequisites.
 */

export type TalentId =
  | 'sharpshooter'
  | 'hardiness'
  | 'swiftFeet'
  | 'quickDraw'
  | 'longShot'
  | 'meditation'
  | 'searingMastery'
  | 'trueshotAura'
  | 'rainStorm'
  | 'deadeye';

export interface TalentDef {
  id: TalentId;
  name: string;
  /** Icon: `atlas:frame` for a game atlas, or `ability:name` for an ability icon. */
  icon: string;
  tier: number;
  col: number;
  maxRank: number;
  /** What the talent does at `rank` (1-based). */
  describe(rank: number): string;
  requires?: TalentId;
  /** An aura: a lasting effect around the hero, shown with the aura art. */
  aura?: boolean;
}

/** Points that must be spent in the tree before each tier opens. */
export const TIER_POINTS = [0, 2, 4, 6];

/** Per-rank values, in one place for the hero's stats and the descriptions. */
export const TALENT_VALUES = {
  sharpshooterDamage: 2,
  hardinessHp: 40,
  swiftFeetSpeed: 3,
  quickDrawAttackSpeed: 6,
  longShotRange: 16,
  meditationMana: 0.5,
  searingDamage: 6,
  searingCost: 2,
  trueshotDamage: 0.15,
  rainStormWaves: 1,
  deadeyeChance: 0.15,
};

const V = TALENT_VALUES;

export const TALENTS: TalentDef[] = [
  { id: 'sharpshooter', name: 'Sharpshooter', icon: 'items:bow_2', tier: 0, col: 0, maxRank: 3, describe: (r) => `+${V.sharpshooterDamage * r} attack damage.` },
  { id: 'hardiness', name: 'Hardiness', icon: 'items:chest_1', tier: 0, col: 1, maxRank: 3, describe: (r) => `+${V.hardinessHp * r} maximum health.` },
  { id: 'swiftFeet', name: 'Swift Feet', icon: 'items:boots_0', tier: 0, col: 2, maxRank: 2, describe: (r) => `+${V.swiftFeetSpeed * r} move speed.` },
  { id: 'quickDraw', name: 'Quick Draw', icon: 'items:quiver_1', tier: 1, col: 0, maxRank: 3, describe: (r) => `+${V.quickDrawAttackSpeed * r}% attack speed.` },
  { id: 'longShot', name: 'Long Shot', icon: 'items:bow_4', tier: 1, col: 1, maxRank: 2, describe: (r) => `+${r} tile${r > 1 ? 's' : ''} attack range.` },
  { id: 'meditation', name: 'Meditation', icon: 'items:amulet_2', tier: 1, col: 2, maxRank: 2, describe: (r) => `+${(V.meditationMana * r).toFixed(1)} mana regeneration per second.` },
  {
    id: 'searingMastery', name: 'Searing Mastery', icon: 'ability:searing', tier: 2, col: 0, maxRank: 2,
    describe: (r) => `Searing Arrows deal +${V.searingDamage * r} fire damage and cost ${V.searingCost * r} less mana.`,
  },
  {
    id: 'trueshotAura', name: 'Trueshot Aura', icon: 'auras:aura_precision_ground_10', tier: 2, col: 1, maxRank: 1, aura: true,
    describe: () => `A golden aura surrounds you: your attacks deal ${Math.round(V.trueshotDamage * 100)}% more damage.`,
  },
  { id: 'rainStorm', name: 'Rain Storm', icon: 'ability:rain', tier: 2, col: 2, maxRank: 2, describe: (r) => `Rain of Arrows lasts ${r} more wave${r > 1 ? 's' : ''}.` },
  {
    id: 'deadeye', name: 'Deadeye', icon: 'rangerfx:ground_target', tier: 3, col: 1, maxRank: 1, requires: 'trueshotAura',
    describe: () => `Your attacks have a ${Math.round(V.deadeyeChance * 100)}% chance to strike a weak spot for double damage.`,
  },
];

export const TALENT_BY_ID = Object.fromEntries(TALENTS.map((t) => [t.id, t])) as Record<TalentId, TalentDef>;

export class Talents {
  readonly ranks = Object.fromEntries(TALENTS.map((t) => [t.id, 0])) as Record<TalentId, number>;
  points = 0;

  rank(id: TalentId): number {
    return this.ranks[id];
  }

  get spent(): number {
    return Object.values(this.ranks).reduce((a, b) => a + b, 0);
  }

  /** Why `id` can't take another point right now, or null if it can. */
  blocked(id: TalentId): string | null {
    const t = TALENT_BY_ID[id];
    if (this.ranks[id] >= t.maxRank) return 'Maximum rank';
    const need = TIER_POINTS[t.tier];
    if (this.spent < need) return `Requires ${need} points in Marksmanship`;
    if (t.requires && this.ranks[t.requires] < TALENT_BY_ID[t.requires].maxRank) return `Requires ${TALENT_BY_ID[t.requires].name}`;
    if (this.points <= 0) return 'No talent points';
    return null;
  }

  /** Spend a point on `id`. Returns false if it isn't allowed. */
  learn(id: TalentId): boolean {
    if (this.blocked(id)) return false;
    this.ranks[id]++;
    this.points--;
    return true;
  }

  /** Refund every point (a free respec). */
  reset(): void {
    this.points += this.spent;
    for (const k of Object.keys(this.ranks) as TalentId[]) this.ranks[k] = 0;
  }
}
