import { describe, expect, it } from 'vitest';
import { TALENTS, TIER_POINTS, Talents } from '../src/entities/talents';

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
