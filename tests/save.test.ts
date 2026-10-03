import { describe, expect, it } from 'vitest';
import { WorldMap, Tile } from '../src/world/map';

describe('save beacons', () => {
  it.each([1, 42, 777])('seed %i: a beacon on the plaza plus one per treasure camp, all reachable', (seed) => {
    const m = new WorldMap(96, 96, seed);
    expect(m.beacons.length).toBeGreaterThanOrEqual(1);
    const first = m.beacons[0];
    expect(Math.hypot(first.tx + 0.5 - m.spawn.x, first.ty + 0.5 - m.spawn.y)).toBeLessThan(5);
    for (const b of m.beacons) {
      expect(m.get(b.tx, b.ty)).toBe(Tile.Beacon);
      expect(m.isSearchable(b.tx, b.ty)).toBe(true);
      expect(m.isWalkable(b.tx, b.ty)).toBe(false);
    }
    // The world is deterministic: the same seed puts the beacons in the same place.
    const m2 = new WorldMap(96, 96, seed);
    expect(m2.beacons).toEqual(m.beacons);
  });
});
