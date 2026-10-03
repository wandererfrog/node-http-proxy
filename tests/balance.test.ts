import { describe, expect, it } from 'vitest';
import { creepMaxHp, creepXp, heroDamage } from '../src/entities/balance';
import { MAX_LEVEL, xpForLevel } from '../src/entities/xp';
import { Inventory } from '../src/entities/items';

describe('combat balance', () => {
  it.each(['skeleton', 'boar'] as const)('a same-level %s dies in 2-3 average hero hits', (kind) => {
    for (let level = 1; level <= 20; level++) {
      const [a, b] = heroDamage(level);
      const hits = Math.ceil(creepMaxHp(kind, level) / ((a + b) / 2));
      expect(hits).toBeGreaterThanOrEqual(2);
      expect(hits).toBeLessThanOrEqual(3);
    }
  });

  it('a melee creep charging from max range takes 2-3 arrows before contact', () => {
    // Mirrors Hero.ts (range 96px, damage point 0.25s, cooldown 1.1s) and Creep.ts speeds/ranges.
    const creeps = [
      { speed: 30, range: 7 }, // skeleton
      { speed: 34, range: 5 }, // boar
    ];
    for (const c of creeps) {
      const contact = (96 - c.range) / c.speed;
      let hits = 0;
      for (let t = 0.25; t < contact; t += 1.1) hits++;
      expect(hits).toBeGreaterThanOrEqual(2);
      expect(hits).toBeLessThanOrEqual(3);
    }
  });
});

describe('levelling pace', () => {
  it('takes about 9 same-level kills for level 2, and more for every level after', () => {
    expect(MAX_LEVEL).toBe(20);
    const kills = (l: number) => (xpForLevel(l + 1) - xpForLevel(l)) / creepXp('skeleton', l);
    expect(kills(1)).toBeGreaterThanOrEqual(8.5);
    expect(kills(1)).toBeLessThanOrEqual(10);
    for (let l = 2; l < MAX_LEVEL; l++) expect(kills(l)).toBeGreaterThan(kills(l - 1));
    expect(kills(19)).toBeGreaterThan(30);
  });
});

describe('Inventory potions', () => {
  it('keeps potions on the belt, never in the bag, up to 9 of each', () => {
    const inv = new Inventory();
    expect(inv.add('hp_potion', 5)).toBe(true);
    expect(inv.add('mp_potion')).toBe(true);
    expect(inv.slots.every((s) => s === null)).toBe(true);
    expect(inv.count('hp_potion')).toBe(5);
    expect(inv.add('hp_potion', 6)).toBe(false); // only 4 fit
    expect(inv.count('hp_potion')).toBe(9);
    expect(inv.takeOne('hp_potion')).toBe(true);
    expect(inv.count('hp_potion')).toBe(8);
  });

  it('runs out cleanly', () => {
    const inv = new Inventory();
    inv.add('mp_potion');
    expect(inv.takeOne('mp_potion')).toBe(true);
    expect(inv.takeOne('mp_potion')).toBe(false);
    expect(inv.count('mp_potion')).toBe(0);
  });
});
