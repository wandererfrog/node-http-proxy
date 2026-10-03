/**
 * Items the hero can carry: stackable consumables (potions) and equipment.
 * Icons are frames of the 'items' atlas sliced from art-source/items-sheet.png.
 */

// --- Consumables ------------------------------------------------------------------------------

export type ItemId = 'hp_potion' | 'mp_potion';

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  description: string;
  maxStack: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hp_potion: { id: 'hp_potion', name: 'Healing Potion', icon: 'potion_0', description: 'Restores 220 health.', maxStack: 9 },
  mp_potion: { id: 'mp_potion', name: 'Mana Potion', icon: 'potion_1', description: 'Restores 120 mana.', maxStack: 9 },
};

/** WC3-style tomes: read on pickup, permanently raise a stat. Found in treasure chests. */
export type TomeId = 'vitality' | 'insight' | 'power' | 'swiftness';

export const TOMES: Record<TomeId, { name: string; effect: string }> = {
  vitality: { name: 'Tome of Vitality', effect: '+60 max health' },
  insight: { name: 'Tome of Insight', effect: '+40 max mana' },
  power: { name: 'Tome of Power', effect: '+4 damage' },
  swiftness: { name: 'Tome of Swiftness', effect: '+3 move speed' },
};

export const TOME_IDS = Object.keys(TOMES) as TomeId[];

// --- Equipment --------------------------------------------------------------------------------

export type GearSlot = 'bow' | 'quiver' | 'helmet' | 'chest' | 'gloves' | 'boots' | 'cloak' | 'ring' | 'amulet';
export const GEAR_SLOTS: GearSlot[] = ['bow', 'quiver', 'helmet', 'chest', 'gloves', 'boots', 'cloak', 'ring', 'amulet'];

export const SLOT_NAMES: Record<GearSlot, string> = {
  bow: 'Bow', quiver: 'Quiver', helmet: 'Helmet', chest: 'Armour', gloves: 'Gloves',
  boots: 'Boots', cloak: 'Cloak', ring: 'Ring', amulet: 'Amulet',
};

export interface GearStats {
  damage: number;
  hp: number;
  mana: number;
  /** flat damage taken off every hit (a hit always does at least 1) */
  armor: number;
  speed: number;
  /** percent faster attacks */
  attackSpeed: number;
  hpRegen: number;
  manaRegen: number;
}

export const EMPTY_STATS: GearStats = { damage: 0, hp: 0, mana: 0, armor: 0, speed: 0, attackSpeed: 0, hpRegen: 0, manaRegen: 0 };

/** The six quality tiers, matching the colour steps on the icon sheet. */
export const TIERS = [
  { name: 'Worn', color: '#a97548' },
  { name: 'Woodland', color: '#6cc24a' },
  { name: 'Iron', color: '#c3c8d4' },
  { name: 'Moonsteel', color: '#5a9bff' },
  { name: 'Gilded', color: '#f2c84b' },
  { name: 'Fey', color: '#c47cff' },
] as const;

export const MAX_TIER = TIERS.length - 1;

/** Level-1, tier-0 stats per slot. Everything scales from these. */
const SLOT_BASE: Record<GearSlot, Partial<GearStats>> = {
  bow: { damage: 4 },
  quiver: { damage: 2, attackSpeed: 4 },
  helmet: { hp: 30, armor: 1 },
  chest: { hp: 50, armor: 2 },
  gloves: { attackSpeed: 6, damage: 1 },
  boots: { speed: 3, hp: 15 },
  cloak: { hpRegen: 1, speed: 1 },
  ring: { mana: 25, manaRegen: 0.6 },
  amulet: { mana: 20, hp: 20 },
};

/** Icon frame per slot and tier (the sheet has seven amulets; the fey one is the last). */
export function gearIcon(slot: GearSlot, tier: number): string {
  if (slot === 'amulet') return `amulet_${[0, 1, 2, 3, 4, 6][tier]}`;
  return `${slot}_${tier}`;
}

export interface Gear {
  slot: GearSlot;
  tier: number;
  level: number;
  name: string;
  icon: string;
  stats: GearStats;
}

/** Stat multiplier: +40% per tier, +10% per item level. */
export function gearScale(tier: number, level: number): number {
  return (1 + 0.4 * tier) * (1 + 0.1 * (level - 1));
}

export function makeGear(slot: GearSlot, tier: number, level: number): Gear {
  const k = gearScale(tier, level);
  const stats = { ...EMPTY_STATS };
  for (const [key, v] of Object.entries(SLOT_BASE[slot]) as Array<[keyof GearStats, number]>) {
    const scaled = v * k;
    stats[key] = key === 'hpRegen' || key === 'manaRegen' ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  }
  return { slot, tier, level, name: `${TIERS[tier].name} ${SLOT_NAMES[slot]}`, icon: gearIcon(slot, tier), stats };
}

export function addStats(a: GearStats, b: GearStats): GearStats {
  const out = { ...a };
  for (const k of Object.keys(b) as Array<keyof GearStats>) out[k] = Math.round((a[k] + b[k]) * 10) / 10;
  return out;
}

/** Human lines for a stat block, e.g. "+6 damage". Zero stats are left out. */
export function describeStats(s: GearStats): string[] {
  const lines: string[] = [];
  if (s.damage) lines.push(`+${s.damage} damage`);
  if (s.attackSpeed) lines.push(`+${s.attackSpeed}% attack speed`);
  if (s.hp) lines.push(`+${s.hp} health`);
  if (s.armor) lines.push(`+${s.armor} armour`);
  if (s.mana) lines.push(`+${s.mana} mana`);
  if (s.speed) lines.push(`+${s.speed} move speed`);
  if (s.hpRegen) lines.push(`+${s.hpRegen} health/s`);
  if (s.manaRegen) lines.push(`+${s.manaRegen} mana/s`);
  return lines;
}

/**
 * Random gear for a drop from something of `level`. Tier odds follow a bell around a centre
 * that climbs with level (about one tier per two levels); `bias` shifts it (chests), and
 * `minTier` sets a floor.
 */
export function rollGear(level: number, rand: () => number = Math.random, minTier = 0, bias = 0): Gear {
  const slot = GEAR_SLOTS[Math.floor(rand() * GEAR_SLOTS.length)];
  const centre = (level - 1) * 0.45 + bias;
  const weights = TIERS.map((_, t) => (t < minTier ? 0 : Math.exp(-((t - centre) ** 2) / 1.3)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  let tier = minTier;
  for (let t = 0; t < weights.length; t++) {
    r -= weights[t];
    if (r <= 0) {
      tier = t;
      break;
    }
  }
  return makeGear(slot, Math.min(MAX_TIER, tier), level);
}

// --- Inventory --------------------------------------------------------------------------------

export interface ItemStack {
  id: ItemId;
  count: number;
}

export type InvEntry = { kind: 'stack'; id: ItemId; count: number } | { kind: 'gear'; gear: Gear };

export const INVENTORY_SIZE = 6;

/** Six slots, like a WC3 hero. Potions stack; each piece of gear takes a slot. */
export class Inventory {
  readonly slots: (InvEntry | null)[] = Array(INVENTORY_SIZE).fill(null);

  /** Adds consumables, stacking where possible. Returns false when they don't all fit. */
  add(id: ItemId, count = 1): boolean {
    const def = ITEMS[id];
    let left = count;
    for (const s of this.slots) {
      if (s && s.kind === 'stack' && s.id === id && s.count < def.maxStack) {
        const n = Math.min(left, def.maxStack - s.count);
        s.count += n;
        left -= n;
        if (left === 0) return true;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, def.maxStack);
        this.slots[i] = { kind: 'stack', id, count: n };
        left -= n;
      }
    }
    return left === 0;
  }

  /** Puts a piece of gear in the first free slot. Returns false when the bag is full. */
  addGear(gear: Gear): boolean {
    const i = this.firstFree();
    if (i < 0) return false;
    this.slots[i] = { kind: 'gear', gear };
    return true;
  }

  firstFree(): number {
    return this.slots.findIndex((s) => s === null);
  }

  count(id: ItemId): number {
    return this.slots.reduce((n, s) => n + (s && s.kind === 'stack' && s.id === id ? s.count : 0), 0);
  }

  /** Removes one of `id` (from the last stack first). Returns false if there was none. */
  takeOne(id: ItemId): boolean {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s && s.kind === 'stack' && s.id === id) {
        s.count--;
        if (s.count <= 0) this.slots[i] = null;
        return true;
      }
    }
    return false;
  }
}
