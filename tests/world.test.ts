import { describe, expect, it } from 'vitest';
import { WorldMap } from '../src/world/map';
import { BODY, LEGS, FACINGS } from '../src/art/sprites';
import { xpForLevel } from '../src/entities/xp';

describe('WorldMap', () => {
  it.each([1, 2, 3, 42, 1337, 99999])('seed %i: spawn is open and every camp is reachable', (seed) => {
    const m = new WorldMap(80, 80, seed);
    expect(m.isWalkable(Math.floor(m.spawn.x), Math.floor(m.spawn.y))).toBe(true);
    expect(m.camps.length).toBeGreaterThanOrEqual(4);
    expect(m.allCampsReachable()).toBe(true);
  });
});

describe('sprites', () => {
  it('every humanoid row is 16 pixels wide and frames are 16 tall', () => {
    for (const f of FACINGS) {
      expect(BODY[f]).toHaveLength(13);
      for (const r of BODY[f]) expect(r).toHaveLength(16);
      for (const legs of Object.values(LEGS[f])) {
        expect(legs).toHaveLength(3);
        for (const r of legs) expect(r).toHaveLength(16);
      }
    }
  });
});

describe('xp curve', () => {
  it('is increasing', () => {
    for (let l = 1; l < 10; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(xpForLevel(1)).toBe(0);
  });
});
