import { describe, expect, it } from 'vitest';
import { Tile, WorldMap, mulberry32, rollGroup } from '../src/world/map';
import { FACINGS, POSES, UNIT_SHEETS } from '../src/art/sprites';
import { xpForLevel } from '../src/entities/xp';
import archer from '../src/assets/sprites/archer.json';
import boar from '../src/assets/sprites/boar.json';
import skeleton from '../src/assets/sprites/skeleton.json';
import boarAlpha from '../src/assets/sprites/boar_alpha.json';
import env from '../src/assets/sprites/elven.json';
import town from '../src/assets/sprites/town.json';
import { GRASS_FRAMES, GROUPS, PROPS, TOWN_ATLAS, footprint } from '../src/world/props';

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

describe('environment props', () => {
  it.each([5, 77, 2024])('seed %i: props own their footprint, decor sits on open ground', (seed) => {
    const m = new WorldMap(96, 96, seed);
    expect(m.props.size).toBeGreaterThan(500);
    for (const [anchor, p] of m.props) {
      const def = PROPS[p.key];
      expect(def, p.key).toBeDefined();
      for (const [dx, dy] of footprint(def)) {
        expect(m.isWalkable(p.tx + dx, p.ty - dy)).toBe(false);
        expect(m.propAt(p.tx + dx, p.ty - dy)).toBe(anchor);
      }
    }
    for (const d of m.decor) {
      const t = m.get(Math.floor(d.x / 16), Math.floor(d.y / 16));
      expect([Tile.Grass, Tile.Dirt, Tile.Water]).toContain(t);
    }
  });

  it.each([3, 31, 4096])('seed %i: the start is the village of Elderglade, with the moonwell before the temple', (seed) => {
    const m = new WorldMap(96, 96, seed);
    const keys = new Set([...m.props.values()].map((p) => p.key));
    expect(keys.has('moonwell')).toBe(true);
    expect(keys.has('cathedral')).toBe(true);
    expect(m.moonwell).not.toBeNull();
    expect(m.get(Math.floor(m.spawn.x), Math.floor(m.spawn.y))).toBe(Tile.Paved);
    expect(m.allCampsReachable()).toBe(true);
    // The hero can walk from the healing circle out to every camp (covered above) and under the arch gate.
    const gate = [...m.props.values()].find((p) => p.key === 'arch_gate');
    if (gate) expect(m.isWalkable(gate.tx + 1, gate.ty)).toBe(true);
  });

  it('every prop and ground frame exists in its atlas', () => {
    for (const [key, def] of Object.entries(PROPS)) expect(def.atlas === TOWN_ATLAS ? town.frames : env.frames).toHaveProperty(key);
    for (const list of Object.values(GROUPS)) for (const key of list) expect(env.frames).toHaveProperty(key);
    // Villagers, guards and townsfolk use the town atlas's people.
    for (const key of ['npc_mage', 'npc_red', 'npc_smith', 'npc_guard', 'npc_grey', 'npc_green', 'npc_white', 'npc_brown', 'npc_blue', 'npc_child', 'npc_girl'])
      expect(town.frames).toHaveProperty(key);
    for (const key of [...GRASS_FRAMES, 'ground_dirt', 'ground_water', 'ground_plaza', 'ground_stone', 'rubble', 'fx_moon', 'fx_runes', 'fx_burst'])
      expect(env.frames).toHaveProperty(key);
  });

  it('clearing one tile of a multi-tile prop removes the whole prop', () => {
    const m = new WorldMap(96, 96, 9);
    const [anchor, p] = [...m.props].find(([, q]) => PROPS[q.key].w > 1)!;
    m.set(p.tx + 1, p.ty, Tile.Grass);
    expect(m.props.has(anchor)).toBe(false);
    expect(m.isWalkable(p.tx, p.ty)).toBe(true);
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
