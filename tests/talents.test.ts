import { describe, expect, it } from 'vitest';
import { TALENTS, TALENT_VALUES, TIER_POINTS, TREES, Talents } from '../src/entities/talents';

describe('talent tree', () => {
  it('has at most 10 talents, exactly one aura, and every grid cell used once', () => {
    expect(TALENTS.length).toBeLessThanOrEqual(10);
    expect(TALENTS.filter((t) => t.aura)).toHaveLength(1);
    const cells = new Set(TALENTS.map((t) => `${t.tier},${t.col}`));
    expect(cells.size).toBe(TALENTS.length);
    for (const t of TALENTS) expect(t.tier).toBeLessThan(TIER_POINTS.length);
  });

  it('opens tiers as points are spent', () => {
    const t = new Talents();
    t.points = 9;
    expect(t.blocked('quickDraw')).toMatch(/Requires 2 points/);
    expect(t.learn('sharpshooter')).toBe(true);
    expect(t.learn('sharpshooter')).toBe(true);
    expect(t.learn('quickDraw')).toBe(true); // tier 2 open at 2 spent
    expect(t.blocked('trueshotAura')).toMatch(/Requires 4 points/); // 3 spent
    expect(t.learn('sharpshooter')).toBe(true);
    expect(t.learn('sharpshooter')).toBe(false); // max rank 3
    expect(t.blocked('trueshotAura')).toBeNull(); // 4 spent: tier 3 open
  });

  it('Deadeye needs Trueshot Aura as well as 6 points', () => {
    const t = new Talents();
    t.points = 7;
    for (const id of ['sharpshooter', 'sharpshooter', 'sharpshooter', 'hardiness', 'hardiness', 'hardiness'] as const) expect(t.learn(id)).toBe(true);
    expect(t.spent).toBe(6);
    expect(t.blocked('deadeye')).toBe('Requires Trueshot Aura');
    expect(t.learn('trueshotAura')).toBe(true);
    expect(t.blocked('deadeye')).toBe('No talent points');
  });

  it('reset refunds every point', () => {
    const t = new Talents();
    t.points = 4;
    t.learn('hardiness');
    t.learn('swiftFeet');
    t.reset();
    expect(t.points).toBe(4);
    expect(t.spent).toBe(0);
  });
});

describe('class trees', () => {
  it.each(['ranger', 'mage', 'knight'] as const)('%s: ten talents, one aura, a capstone that needs it, every cell used once', (cls) => {
    const tree = TREES[cls].talents;
    expect(tree).toHaveLength(10);
    const auras = tree.filter((t) => t.aura);
    expect(auras).toHaveLength(1);
    const cells = new Set(tree.map((t) => `${t.tier},${t.col}`));
    expect(cells.size).toBe(tree.length);
    const capstone = tree.find((t) => t.tier === 3)!;
    expect(capstone.requires).toBe(auras[0].id);
    // 21 ranks against 10 points: you have to choose.
    expect(tree.reduce((n, t) => n + t.maxRank, 0)).toBe(21);
  });

  it('talent ids are unique across all trees', () => {
    const ids = Object.values(TREES).flatMap((t) => t.talents.map((d) => d.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a class can only learn its own tree's talents, and stats add up", () => {
    const k = new Talents('knight');
    k.points = 10;
    expect(k.learn('sharpshooter')).toBe(false);
    expect(k.blocked('sharpshooter')).toBe('Not in your tree');
    for (const id of ['toughness', 'toughness', 'plateMastery', 'plateMastery', 'might', 'battleRhythm', 'devotionAura']) expect(k.learn(id)).toBe(true);
    const s = k.stats();
    expect(s.hp).toBe(100);
    expect(s.armor).toBe(2 + TALENT_VALUES.devotionArmor);
    expect(s.damage).toBe(2);
    expect(s.attackSpeed).toBe(6);
    expect(s.damagePct).toBeCloseTo(TALENT_VALUES.devotionDamage);
    expect(k.aura).toBe('precision');
    expect(new Talents('mage').rank('frostbite')).toBe(0);
  });
});
