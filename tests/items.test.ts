import { describe, expect, it } from 'vitest';
import { GEAR_SLOTS, Inventory, MAX_TIER, TIERS, gearIcon, makeGear, rollGear } from '../src/entities/items';
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

  it('drops better tiers from higher-level creeps, and chests never drop junk', () => {
    const rand = mulberry32(5);
    const avg = (level: number, min = 0, bias = 0) => {
      let s = 0;
      for (let i = 0; i < 400; i++) s += rollGear(level, rand, min, bias).tier;
      return s / 400;
    };
    expect(avg(1)).toBeLessThan(1);
    expect(avg(8)).toBeGreaterThan(avg(1) + 1.5);
    for (let i = 0; i < 100; i++) expect(rollGear(3, rand, 2, 1.5).tier).toBeGreaterThanOrEqual(2);
  });
});

describe('Inventory with gear', () => {
  it('gear takes a slot each and does not stack', () => {
    const inv = new Inventory();
    for (let i = 0; i < 6; i++) expect(inv.addGear(makeGear('bow', 0, 1))).toBe(true);
    expect(inv.addGear(makeGear('bow', 0, 1))).toBe(false);
    expect(inv.add('hp_potion')).toBe(false);
    expect(inv.count('hp_potion')).toBe(0);
  });
});
