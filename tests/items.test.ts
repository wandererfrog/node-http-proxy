import { describe, expect, it } from 'vitest';
import { GEAR_SLOTS, INVENTORY_SIZE, Inventory, MAX_TIER, TIERS, gearIcon, gearValue, makeGear, requiredLevel, rollGear } from '../src/entities/items';
import { mulberry32 } from '../src/world/map';
import items from '../src/assets/sprites/items.json';

describe('gear', () => {
  it('gets stronger with tier and level', () => {
    for (const slot of GEAR_SLOTS) {
      const sum = (t: number, l: number) => Object.values(makeGear(slot, t, l).stats).reduce((a, b) => a + b, 0);
      expect(sum(1, 1)).toBeGreaterThan(sum(0, 1));
      expect(sum(MAX_TIER, 1)).toBeGreaterThan(sum(2, 1));
      expect(sum(0, 5)).toBeGreaterThan(sum(0, 1));
    }
  });

  it('every slot and tier has an icon in the items atlas', () => {
    for (const slot of GEAR_SLOTS) for (let t = 0; t <= MAX_TIER; t++) expect(items.frames).toHaveProperty(gearIcon(slot, t));
    for (const f of ['potion_0', 'potion_1', 'misc_7']) expect(items.frames).toHaveProperty(f);
    expect(TIERS).toHaveLength(6);
  });

  it('drops follow rarity: mostly Common, Rare and up are rare, Legendary almost never', () => {
    const rand = mulberry32(5);
    const share = (level: number) => {
      const n = 20000;
      const counts = Array(6).fill(0);
      for (let i = 0; i < n; i++) counts[rollGear(level, rand).tier]++;
      return counts.map((c) => c / n);
    };
    const l1 = share(1);
    expect(l1[0]).toBeGreaterThan(0.5);
    expect(l1[3] + l1[4] + l1[5]).toBeLessThan(0.07);
    expect(l1[5]).toBeLessThan(0.006);
    // Deeper creeps tilt the odds up, but Common is still the most likely.
    const l10 = share(10);
    expect(l10[3] + l10[4] + l10[5]).toBeGreaterThan(l1[3] + l1[4] + l1[5]);
    expect(l10[0]).toBeGreaterThan(l10[1]);
    // Chests never drop junk.
    for (let i = 0; i < 100; i++) expect(rollGear(3, rand, 2, 1.5).tier).toBeGreaterThanOrEqual(2);
  });

  it('needs the right level to wear, and sells for more when rarer', () => {
    expect(requiredLevel(makeGear('bow', 0, 1))).toBe(1);
    expect(requiredLevel(makeGear('bow', 0, 7))).toBe(6);
    expect(gearValue(makeGear('ring', 4, 5))).toBeGreaterThan(gearValue(makeGear('ring', 1, 5)));
  });
});

describe('Inventory with gear', () => {
  it('gear takes a slot each and does not stack', () => {
    const inv = new Inventory();
    expect(INVENTORY_SIZE).toBe(24);
    for (let i = 0; i < INVENTORY_SIZE; i++) expect(inv.addGear(makeGear('bow', 0, 1))).toBe(true);
    expect(inv.addGear(makeGear('bow', 0, 1))).toBe(false);
    // A full bag still takes potions: they go on the belt.
    expect(inv.add('hp_potion')).toBe(true);
    expect(inv.count('hp_potion')).toBe(1);
  });

  it('rearranges by swapping slots, or moving into an empty one', () => {
    const inv = new Inventory();
    const a = makeGear('bow', 0, 1);
    const b = makeGear('ring', 2, 1);
    inv.addGear(a);
    inv.addGear(b);
    inv.move(0, 1);
    expect(inv.slots[0]?.gear).toBe(b);
    expect(inv.slots[1]?.gear).toBe(a);
    inv.move(1, 5);
    expect(inv.slots[1]).toBeNull();
    expect(inv.slots[5]?.gear).toBe(a);
  });
});
