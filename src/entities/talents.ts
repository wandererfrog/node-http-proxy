import type { AuraName } from '../art/sprites';

/**
 * Talent trees, one per class (WoW style): ten talents in four tiers. A talent point comes every
 * second hero level (levels 2, 4, ... 20: ten points against 21 ranks, so you choose). A tier opens
 * once enough points are spent in the tree, and the capstone also needs the tree's aura, drawn as
 * an arrow between them like WoW's prerequisites.
 *
 * Most talents are plain stat bonuses (`stats`); a few change an ability, and the abilities read
 * their rank directly (e.g. Rain Storm, Frostbite, Concussion).
 */

export type ClassId = 'ranger' | 'mage' | 'knight';

export type TalentId = string;

/** What talents add to the hero, per rank already multiplied in. */
export interface TalentStats {
  damage: number;
  hp: number;
  mana: number;
  speed: number;
  /** % attack speed */
  attackSpeed: number;
  /** px of attack range */
  range: number;
  hpRegen: number;
  manaRegen: number;
  armor: number;
  /** Fraction more damage on every attack (0.15 = +15%). */
  damagePct: number;
  /** Chance for an attack to deal double damage. */
  crit: number;
}

export const NO_TALENT_STATS: TalentStats = { damage: 0, hp: 0, mana: 0, speed: 0, attackSpeed: 0, range: 0, hpRegen: 0, manaRegen: 0, armor: 0, damagePct: 0, crit: 0 };

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
  /** An aura: a lasting effect around the hero, shown with this aura's art. */
  aura?: AuraName;
  /** Stat bonuses at `rank`. */
  stats?(rank: number): Partial<TalentStats>;
}

/** Points that must be spent in the tree before each tier opens. */
export const TIER_POINTS = [0, 2, 4, 6];

/** Per-rank values, in one place for the abilities and the descriptions. */
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
  // mage
  frostbiteFreeze: 0.5,
  orbMasteryDamage: 15,
  brillianceMana: 2,
  brillianceDamage: 0.1,
  // knight
  concussionStun: 0.5,
  cycloneDamage: 8,
  devotionArmor: 3,
  devotionDamage: 0.1,
};

const V = TALENT_VALUES;

const RANGER: TalentDef[] = [
  { id: 'sharpshooter', name: 'Sharpshooter', icon: 'items:bow_2', tier: 0, col: 0, maxRank: 3, describe: (r) => `+${V.sharpshooterDamage * r} attack damage.`, stats: (r) => ({ damage: V.sharpshooterDamage * r }) },
  { id: 'hardiness', name: 'Hardiness', icon: 'items:chest_1', tier: 0, col: 1, maxRank: 3, describe: (r) => `+${V.hardinessHp * r} maximum health.`, stats: (r) => ({ hp: V.hardinessHp * r }) },
  { id: 'swiftFeet', name: 'Swift Feet', icon: 'items:boots_0', tier: 0, col: 2, maxRank: 2, describe: (r) => `+${V.swiftFeetSpeed * r} move speed.`, stats: (r) => ({ speed: V.swiftFeetSpeed * r }) },
  { id: 'quickDraw', name: 'Quick Draw', icon: 'items:quiver_1', tier: 1, col: 0, maxRank: 3, describe: (r) => `+${V.quickDrawAttackSpeed * r}% attack speed.`, stats: (r) => ({ attackSpeed: V.quickDrawAttackSpeed * r }) },
  { id: 'longShot', name: 'Long Shot', icon: 'items:bow_4', tier: 1, col: 1, maxRank: 2, describe: (r) => `+${r} tile${r > 1 ? 's' : ''} attack range.`, stats: (r) => ({ range: V.longShotRange * r }) },
  { id: 'meditation', name: 'Meditation', icon: 'items:amulet_2', tier: 1, col: 2, maxRank: 2, describe: (r) => `+${(V.meditationMana * r).toFixed(1)} mana regeneration per second.`, stats: (r) => ({ manaRegen: V.meditationMana * r }) },
  {
    id: 'searingMastery', name: 'Searing Mastery', icon: 'ability:searing', tier: 2, col: 0, maxRank: 2,
    describe: (r) => `Searing Arrows deal +${V.searingDamage * r} fire damage and cost ${V.searingCost * r} less mana.`,
  },
  {
    id: 'trueshotAura', name: 'Trueshot Aura', icon: 'auras:aura_precision_ground_10', tier: 2, col: 1, maxRank: 1, aura: 'precision',
    describe: () => `A golden aura surrounds you: your attacks deal ${Math.round(V.trueshotDamage * 100)}% more damage.`,
    stats: () => ({ damagePct: V.trueshotDamage }),
  },
  { id: 'rainStorm', name: 'Rain Storm', icon: 'ability:rain', tier: 2, col: 2, maxRank: 2, describe: (r) => `Rain of Arrows lasts ${r} more wave${r > 1 ? 's' : ''}.` },
  {
    id: 'deadeye', name: 'Deadeye', icon: 'rangerfx:ground_target', tier: 3, col: 1, maxRank: 1, requires: 'trueshotAura',
    describe: () => `Your attacks have a ${Math.round(V.deadeyeChance * 100)}% chance to strike a weak spot for double damage.`,
    stats: () => ({ crit: V.deadeyeChance }),
  },
];

const MAGE: TalentDef[] = [
  { id: 'arcanePower', name: 'Arcane Power', icon: 'classfx:bolt_3', tier: 0, col: 0, maxRank: 3, describe: (r) => `+${2 * r} attack damage.`, stats: (r) => ({ damage: 2 * r }) },
  { id: 'arcaneMind', name: 'Arcane Mind', icon: 'items:amulet_3', tier: 0, col: 1, maxRank: 3, describe: (r) => `+${40 * r} maximum mana.`, stats: (r) => ({ mana: 40 * r }) },
  { id: 'fortitude', name: 'Fortitude', icon: 'items:chest_2', tier: 0, col: 2, maxRank: 2, describe: (r) => `+${35 * r} maximum health.`, stats: (r) => ({ hp: 35 * r }) },
  { id: 'quickCasting', name: 'Quick Casting', icon: 'items:ring_2', tier: 1, col: 0, maxRank: 3, describe: (r) => `+${6 * r}% attack speed.`, stats: (r) => ({ attackSpeed: 6 * r }) },
  { id: 'focusMind', name: 'Focused Mind', icon: 'items:amulet_0', tier: 1, col: 1, maxRank: 2, describe: (r) => `+${(0.6 * r).toFixed(1)} mana regeneration per second.`, stats: (r) => ({ manaRegen: 0.6 * r }) },
  { id: 'farSight', name: 'Far Sight', icon: 'items:ring_5', tier: 1, col: 2, maxRank: 2, describe: (r) => `+${r} tile${r > 1 ? 's' : ''} attack range.`, stats: (r) => ({ range: 16 * r }) },
  { id: 'frostbite', name: 'Frostbite', icon: 'classfx:nova_3', tier: 2, col: 0, maxRank: 2, describe: (r) => `Frost Nova freezes enemies ${(V.frostbiteFreeze * r).toFixed(1)}s longer.` },
  {
    id: 'brillianceAura', name: 'Brilliance Aura', icon: 'auras:aura_focus_ground_6', tier: 2, col: 1, maxRank: 1, aura: 'focus',
    describe: () => `A blue aura surrounds you: +${V.brillianceMana} mana regeneration and ${Math.round(V.brillianceDamage * 100)}% more damage.`,
    stats: () => ({ manaRegen: V.brillianceMana, damagePct: V.brillianceDamage }),
  },
  { id: 'orbMastery', name: 'Orb Mastery', icon: 'classfx:orb_1', tier: 2, col: 2, maxRank: 2, describe: (r) => `Arcane Orb deals +${V.orbMasteryDamage * r} damage.` },
  {
    id: 'criticalMass', name: 'Critical Mass', icon: 'classfx:bolt_5', tier: 3, col: 1, maxRank: 1, requires: 'brillianceAura',
    describe: () => '15% chance for your attacks to deal double damage.', stats: () => ({ crit: 0.15 }),
  },
];

const KNIGHT: TalentDef[] = [
  { id: 'might', name: 'Might', icon: 'items:dagger_4', tier: 0, col: 0, maxRank: 3, describe: (r) => `+${2 * r} attack damage.`, stats: (r) => ({ damage: 2 * r }) },
  { id: 'toughness', name: 'Toughness', icon: 'items:chest_4', tier: 0, col: 1, maxRank: 3, describe: (r) => `+${50 * r} maximum health.`, stats: (r) => ({ hp: 50 * r }) },
  { id: 'plateMastery', name: 'Plate Mastery', icon: 'items:helmet_4', tier: 0, col: 2, maxRank: 2, describe: (r) => `+${r} armour.`, stats: (r) => ({ armor: r }) },
  { id: 'battleRhythm', name: 'Battle Rhythm', icon: 'items:gloves_4', tier: 1, col: 0, maxRank: 3, describe: (r) => `+${6 * r}% attack speed.`, stats: (r) => ({ attackSpeed: 6 * r }) },
  { id: 'vigor', name: 'Vigor', icon: 'items:belt_3', tier: 1, col: 1, maxRank: 2, describe: (r) => `+${(1.5 * r).toFixed(1)} health regeneration per second.`, stats: (r) => ({ hpRegen: 1.5 * r }) },
  { id: 'charger', name: 'Charger', icon: 'items:boots_4', tier: 1, col: 2, maxRank: 2, describe: (r) => `+${3 * r} move speed.`, stats: (r) => ({ speed: 3 * r }) },
  { id: 'concussion', name: 'Concussion', icon: 'classfx:bash_3', tier: 2, col: 0, maxRank: 2, describe: (r) => `Shield Bash stuns ${(V.concussionStun * r).toFixed(1)}s longer.` },
  {
    id: 'devotionAura', name: 'Devotion Aura', icon: 'auras:aura_precision_ground_4', tier: 2, col: 1, maxRank: 1, aura: 'precision',
    describe: () => `A golden aura surrounds you: +${V.devotionArmor} armour and ${Math.round(V.devotionDamage * 100)}% more damage.`,
    stats: () => ({ armor: V.devotionArmor, damagePct: V.devotionDamage }),
  },
  { id: 'cyclone', name: 'Cyclone', icon: 'classfx:whirl_2', tier: 2, col: 2, maxRank: 2, describe: (r) => `Whirlwind deals +${V.cycloneDamage * r} damage per spin.` },
  {
    id: 'crushingBlow', name: 'Crushing Blow', icon: 'items:dagger_5', tier: 3, col: 1, maxRank: 1, requires: 'devotionAura',
    describe: () => '15% chance for your attacks to deal double damage.', stats: () => ({ crit: 0.15 }),
  },
];

export const TREES: Record<ClassId, { name: string; talents: TalentDef[] }> = {
  ranger: { name: 'Marksmanship', talents: RANGER },
  mage: { name: 'Arcane', talents: MAGE },
  knight: { name: 'Protection', talents: KNIGHT },
};

/** The Ranger's tree (the original one). */
export const TALENTS = RANGER;

/** Every talent of every class by id (ids are unique across trees). */
export const TALENT_BY_ID: Record<TalentId, TalentDef> = Object.fromEntries(Object.values(TREES).flatMap((t) => t.talents.map((d) => [d.id, d])));

export class Talents {
  readonly tree: TalentDef[];
  readonly treeName: string;
  readonly ranks: Record<TalentId, number>;
  points = 0;

  constructor(readonly cls: ClassId = 'ranger') {
    this.tree = TREES[cls].talents;
    this.treeName = TREES[cls].name;
    this.ranks = Object.fromEntries(this.tree.map((t) => [t.id, 0]));
  }

  /** Rank of a talent (0 for talents of another class's tree). */
  rank(id: TalentId): number {
    return this.ranks[id] ?? 0;
  }

  get spent(): number {
    return Object.values(this.ranks).reduce((a, b) => a + b, 0);
  }

  /** Sum of every learned talent's stat bonuses. */
  stats(): TalentStats {
    const s = { ...NO_TALENT_STATS };
    for (const t of this.tree) {
      const r = this.ranks[t.id];
      if (!r || !t.stats) continue;
      for (const [k, v] of Object.entries(t.stats(r)) as Array<[keyof TalentStats, number]>) s[k] += v;
    }
    return s;
  }

  /** The aura of a learned aura talent, if any. */
  get aura(): AuraName | null {
    const t = this.tree.find((d) => d.aura && this.ranks[d.id] > 0);
    return t?.aura ?? null;
  }

  /** Why `id` can't take another point right now, or null if it can. */
  blocked(id: TalentId): string | null {
    const t = TALENT_BY_ID[id];
    if (!t || !(id in this.ranks)) return 'Not in your tree';
    if (this.ranks[id] >= t.maxRank) return 'Maximum rank';
    const need = TIER_POINTS[t.tier];
    if (this.spent < need) return `Requires ${need} points in ${this.treeName}`;
    if (t.requires && this.rank(t.requires) < TALENT_BY_ID[t.requires].maxRank) return `Requires ${TALENT_BY_ID[t.requires].name}`;
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
    for (const k of Object.keys(this.ranks)) this.ranks[k] = 0;
  }
}
