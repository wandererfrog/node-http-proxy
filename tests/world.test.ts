import { describe, expect, it } from 'vitest';
import { WorldMap } from '../src/world/map';
import { FACINGS, POSES, UNIT_SHEETS } from '../src/art/sprites';
import { xpForLevel } from '../src/entities/xp';
import archer from '../src/assets/sprites/archer.json';
import boar from '../src/assets/sprites/boar.json';
import skeleton from '../src/assets/sprites/skeleton.json';
import boarAlpha from '../src/assets/sprites/boar_alpha.json';

describe('WorldMap', () => {
  it.each([1, 2, 3, 42, 1337, 99999])('seed %i: spawn is open and every camp is reachable', (seed) => {
    const m = new WorldMap(80, 80, seed);
    expect(m.isWalkable(Math.floor(m.spawn.x), Math.floor(m.spawn.y))).toBe(true);
    expect(m.camps.length).toBeGreaterThanOrEqual(4);
    expect(m.allCampsReachable()).toBe(true);
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
