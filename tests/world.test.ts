import { describe, expect, it } from 'vitest';
import { Tile, WorldMap, mulberry32, rollGroup } from '../src/world/map';
import { FACINGS, POSES, UNIT_SHEETS } from '../src/art/sprites';
import { xpForLevel } from '../src/entities/xp';
import archer from '../src/assets/sprites/archer.json';
import boar from '../src/assets/sprites/boar.json';
import skeleton from '../src/assets/sprites/skeleton.json';
import boarAlpha from '../src/assets/sprites/boar_alpha.json';

describe('WorldMap', () => {
  it.each([1, 2, 3, 42, 1337, 99999])('seed %i: lots of camps, all reachable, with guarded treasure', (seed) => {
    const m = new WorldMap(96, 96, seed);
    expect(m.isWalkable(Math.floor(m.spawn.x), Math.floor(m.spawn.y))).toBe(true);
    expect(m.camps.length).toBeGreaterThanOrEqual(15);
    expect(m.allCampsReachable()).toBe(true);
    const treasure = m.camps.filter((c) => c.treasure);
    expect(treasure.length).toBeGreaterThanOrEqual(2);
    expect(treasure.length).toBeLessThan(m.camps.length / 3); // stays rare
    for (const c of treasure) {
      expect(c.members).toHaveLength(3);
      expect(m.get(Math.floor(c.x), Math.floor(c.y))).toBe(Tile.Chest);
    }
    // Group sizes vary.
    expect(new Set(m.camps.map((c) => c.members.length)).size).toBeGreaterThanOrEqual(3);
  });

  it('rollGroup makes groups of 1-5, solo creeps a level up, treasure guards a level up', () => {
    const rand = mulberry32(7);
    const sizes = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const g = rollGroup(rand, 1 + (i % 6), false);
      sizes.add(g.members.length);
      expect(g.levelBonus).toBe(g.members.length === 1 ? 1 : 0);
    }
    expect([...sizes].sort()).toEqual([1, 2, 3, 4, 5]);
    const t = rollGroup(rand, 4, true);
    expect(t.members).toHaveLength(3);
    expect(t.levelBonus).toBe(1);
  });
});

describe('sprite atlases', () => {
  const atlases: Record<string, { frames: Record<string, unknown> }> = { archer, boar, skeleton, boar_alpha: boarAlpha };
  it.each([...UNIT_SHEETS])('%s has every facing x pose frame the game uses', (key) => {
    for (const f of FACINGS) for (const p of POSES) expect(atlases[key].frames).toHaveProperty(`${f}_${p}`);
  });
});

describe('xp curve', () => {
  it('is increasing', () => {
    for (let l = 1; l < 10; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(xpForLevel(1)).toBe(0);
  });
});
