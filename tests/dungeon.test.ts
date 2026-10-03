import { describe, expect, it } from 'vitest';
import { Tile, WorldMap } from '../src/world/map';
import { findTilePath } from '../src/world/pathfinding';
import { layoutDungeon } from '../src/world/dungeon';
import { mulberry32 } from '../src/world/map';

const reach = (m: WorldMap, tx: number, ty: number) => findTilePath(m, Math.floor(m.spawn.x), Math.floor(m.spawn.y), tx, ty) !== null;

describe('dungeon layouts', () => {
  it.each([1, 2, 3, 42, 777, 9001])('seed %i: rooms are all connected, boss is the farthest', (seed) => {
    const L = layoutDungeon(mulberry32(seed), 64, 56);
    expect(L.rooms.length).toBeGreaterThanOrEqual(6);
    expect(L.distance.every((d) => d >= 0)).toBe(true);
    expect(L.boss).not.toBe(L.start);
    expect(Math.max(...L.distance)).toBe(L.distance[L.boss]);
  });
});

describe('dungeon maps', () => {
  it.each([1, 2, 3, 42, 777, 9001])('seed %i: an exit, a way down, camps, lights, and everything reachable', (seed) => {
    const m = new WorldMap(64, 56, seed, { kind: 'dungeon', depth: 1, level: 3 });
    expect(m.kind).toBe('dungeon');
    expect(m.isWalkable(Math.floor(m.spawn.x), Math.floor(m.spawn.y))).toBe(true);
    const exit = m.portals.find((p) => p.kind === 'exit');
    const down = m.portals.find((p) => p.kind === 'down');
    expect(exit).toBeDefined();
    expect(down).toBeDefined();
    for (const p of [exit!, down!]) {
      const i = p.tiles[0];
      expect(reach(m, i % m.width, Math.floor(i / m.width))).toBe(true);
    }
    expect(m.camps.length).toBeGreaterThanOrEqual(4);
    expect(m.camps.filter((c) => c.treasure)).toHaveLength(1);
    for (const c of m.camps) expect(reach(m, Math.floor(c.x), Math.floor(c.y) + (c.treasure ? 1 : 0))).toBe(true);
    expect(m.lights.length).toBeGreaterThan(4);
    // Walls stop arrows; floor does not.
    expect(m.blocksProjectiles(0, 0)).toBe(true);
    expect(m.get(0, 0)).toBe(Tile.Wall);
  });

  it('the same seed gives the same dungeon', () => {
    const a = new WorldMap(64, 56, 5, { kind: 'dungeon', depth: 2, level: 4 });
    const b = new WorldMap(64, 56, 5, { kind: 'dungeon', depth: 2, level: 4 });
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });
});

describe('dungeon entrances in the overworld', () => {
  it.each([1, 42, 777])('seed %i: four gates on the 128x128 overworld, far from the start, all reachable', (seed) => {
    const m = new WorldMap(128, 128, seed);
    const enters = m.portals.filter((p) => p.kind === 'enter');
    expect(enters.length).toBe(4);
    for (const p of enters) {
      const i = p.tiles[0];
      const tx = i % m.width;
      const ty = Math.floor(i / m.width);
      expect(m.isWalkable(tx, ty)).toBe(true);
      expect(reach(m, tx, ty)).toBe(true);
      expect(Math.hypot(tx - m.spawn.x, ty - m.spawn.y)).toBeGreaterThan(15);
      expect(p.level).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the village', () => {
  it.each([1, 42, 777])('seed %i: three villagers in Elderglade, each reachable', (seed) => {
    const m = new WorldMap(128, 128, seed);
    expect(m.npcs.map((n) => n.id).sort()).toEqual(['elder', 'merchant', 'warden']);
    for (const n of m.npcs) {
      expect(m.isWalkable(n.tx, n.ty)).toBe(false); // villagers block their tile
      expect(Math.hypot(n.tx - m.spawn.x, n.ty - m.spawn.y)).toBeLessThan(10);
      const nextTo = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.isWalkable(n.tx + dx, n.ty + dy) && reach(m, n.tx + dx, n.ty + dy));
      expect(nextTo).toBe(true);
    }
    expect(new WorldMap(64, 56, seed, { kind: 'dungeon', depth: 1, level: 2 }).npcs).toEqual([]);
  });
});
