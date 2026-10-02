import { describe, expect, it } from 'vitest';
import { creepMaxHp, heroDamage } from '../src/entities/balance';
import { Inventory } from '../src/entities/items';

describe('combat balance', () => {
  it.each(['skeleton', 'boar'] as const)('a same-level %s dies in 2-3 average hero hits', (kind) => {
    for (let level = 1; level <= 10; level++) {
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

describe('Inventory', () => {
  it('stacks potions and fills six slots', () => {
    const inv = new Inventory();
    expect(inv.add('hp_potion', 12)).toBe(true); // 9 + 3
    expect(inv.slots.filter(Boolean)).toHaveLength(2);
    expect(inv.add('mp_potion')).toBe(true);
    expect(inv.count('hp_potion')).toBe(12);
    expect(inv.takeOne('hp_potion')).toBe(true);
    expect(inv.count('hp_potion')).toBe(11);
    expect(inv.add('mp_potion', 9 * 4)).toBe(false); // only room for 3 more stacks
  });

  it('frees a slot when its last item is used', () => {
    const inv = new Inventory();
    inv.add('mp_potion');
    expect(inv.takeOne('mp_potion')).toBe(true);
    expect(inv.slots.every((s) => s === null)).toBe(true);
    expect(inv.takeOne('mp_potion')).toBe(false);
  });
});
