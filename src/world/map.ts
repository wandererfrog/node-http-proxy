import { Grid, Point, findTilePath } from './pathfinding';
import type { CreepKind } from '../entities/balance';
import { GROUPS, PROPS } from './props';

export const TILE = 16;

export enum Tile {
  Grass = 0,
  Dirt = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  /** Treasure chest in the middle of a guarded camp. */
  Chest = 5,
  /** Solid prop that doesn't stop arrows: boulders, ruins, logs, village props. */
  Block = 6,
}

/** A prop sprite on the map, anchored at its bottom-left footprint tile. */
export interface PropPlacement {
  key: string;
  tx: number;
  ty: number;
}

/** Non-blocking ground detail (tufts, flowers, pebbles, lily pads), in world pixels. */
export interface Decor {
  key: string;
  x: number;
  y: number;
}

export interface CampSpec {
  /** tile-space centre */
  x: number;
  y: number;
  /** Creep level: camps get tougher the further they are from the spawn. */
  level: number;
  /** Who guards the camp. Groups vary from a lone creep to packs of five. */
  members: CreepKind[];
  /** Rare: three elite guards around a treasure chest at the centre tile. */
  treasure: boolean;
}

/** Camp level from distance to the spawn (tiles). */
export function campLevel(dist: number): number {
  return Math.max(1, Math.min(8, 1 + Math.floor((dist - 10) / 6)));
}

/**
 * Pick a group of creeps for a camp. Solo creeps are a level up so they still matter;
 * boars get more common deeper in; big boar packs at level 3+ may be led by an alpha.
 * Returns the members and the level adjustment.
 */
export function rollGroup(rand: () => number, level: number, treasure: boolean): { members: CreepKind[]; levelBonus: number } {
  const pBoar = Math.min(0.7, 0.15 + 0.1 * level);
  const pick = (): CreepKind => (rand() < pBoar ? 'boar' : 'skeleton');
  if (treasure) {
    const members: CreepKind[] = [pick(), pick(), pick()];
    if (level >= 3 && rand() < 0.6) members[0] = 'alphaBoar';
    return { members, levelBonus: 1 };
  }
  const r = rand();
  const size = r < 0.15 ? 1 : r < 0.45 ? 2 : r < 0.8 ? 3 : 4 + (rand() < 0.5 ? 1 : 0);
  const members = Array.from({ length: size }, pick);
  if (size >= 4 && level >= 3 && members.includes('boar') && rand() < 0.5) members[members.indexOf('boar')] = 'alphaBoar';
  return { members, levelBonus: size === 1 ? 1 : 0 };
}

/** Small deterministic PRNG so a seed always gives the same map. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise, smoothed, in [0, 1). */
function makeNoise(rand: () => number, size: number): (x: number, y: number) => number {
  const lattice = new Float64Array(size * size).map(() => rand());
  const at = (x: number, y: number) => lattice[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = smooth(x - x0);
    const sy = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

const pickFrom = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

/** Biome noise sampled per tile; kept so decoration can follow the same regions. */
interface Biome {
  forest: number;
  pine: number;
  rocky: number;
}

export class WorldMap implements Grid {
  readonly tiles: Uint8Array;
  /** per-tile random variant for decoration (grass tufts, flowers...) */
  readonly variant: Uint8Array;
  readonly camps: CampSpec[] = [];
  readonly spawn: Point;
  /** Props by anchor tile index. */
  readonly props = new Map<number, PropPlacement>();
  /** For every blocked tile that belongs to a prop: the anchor index of that prop. */
  private readonly owner: Int32Array;
  readonly decor: Decor[] = [];
  private readonly biome: Biome[] = [];
  /** Props placed to dress camps and the start, so they can be removed if they block a path. */
  private dressing: Array<{ anchor: number; camp: number }> = [];

  constructor(readonly width: number, readonly height: number, seed = 1337) {
    this.tiles = new Uint8Array(width * height);
    this.variant = new Uint8Array(width * height);
    this.owner = new Int32Array(width * height).fill(-1);
    const rand = mulberry32(seed);
    const forest = makeNoise(rand, 64);
    const lakes = makeNoise(rand, 64);
    const pines = makeNoise(rand, 64);
    const rocks = makeNoise(rand, 64);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        this.variant[i] = Math.floor(rand() * 256);
        this.biome.push({
          forest: forest(x / 7, y / 7) + forest(x / 3, y / 3) * 0.35,
          pine: pines(x / 11 + 50, y / 11 + 50),
          rocky: rocks(x / 6 + 200, y / 6 + 200),
        });
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (this.owner[i] !== -1) continue; // part of a multi-tile prop placed earlier in this row
        const b = this.biome[i];
        const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (edge < 2) {
          this.placeProp(x, y, this.treeFor(b, rand), true);
          continue;
        }
        if (lakes(x / 9 + 100, y / 9 + 100) > 0.78) {
          this.tiles[i] = Tile.Water;
          continue;
        }
        const r = rand();
        if (b.forest > 1.0) this.placeProp(x, y, this.treeFor(b, rand));
        else if (b.forest > 0.9 && r < 0.4) this.placeProp(x, y, rand() < 0.75 ? pickFrom(rand, GROUPS.bush) : this.treeFor(b, rand));
        else if (b.rocky > 0.68 && r < 0.16) {
          const q = rand();
          this.placeProp(x, y, q < 0.45 ? pickFrom(rand, GROUPS.boulder) : q < 0.8 ? pickFrom(rand, GROUPS.rock) : pickFrom(rand, GROUPS.dead));
        } else if (r < 0.012) this.placeProp(x, y, pickFrom(rand, GROUPS.rock));
        else if (r < 0.022) this.placeProp(x, y, this.treeFor(b, rand, true));
        else if (r < 0.032) this.placeProp(x, y, pickFrom(rand, GROUPS.bush));
        else if (r < 0.036) this.placeProp(x, y, pickFrom(rand, [...GROUPS.stump, ...GROUPS.wood]));
      }
    }

    this.spawn = { x: Math.floor(width / 2) + 0.5, y: Math.floor(height / 2) + 0.5 };
    this.clearCircle(this.spawn.x, this.spawn.y, 4.5);
    this.paintCircle(this.spawn.x, this.spawn.y, 2.2, Tile.Dirt);

    this.placeCamps(rand);
    this.dressSpawn(rand);
    this.ensureReachable();
    // Chests go in last so no road or dressing clears them away.
    for (const c of this.camps) if (c.treasure) this.set(Math.floor(c.x), Math.floor(c.y), Tile.Chest);
    this.scatterDecor(rand);
  }

  /** A tree that fits the biome: pine woods, oak woods, or a lone tree in the open. */
  private treeFor(b: Biome, rand: () => number, lone = false): string {
    const r = rand();
    if (b.pine > 0.52) return r < 0.75 ? pickFrom(rand, GROUPS.pine) : r < 0.9 ? pickFrom(rand, GROUPS.pineSmall) : pickFrom(rand, GROUPS.oakSmall);
    if (lone) return r < 0.6 ? pickFrom(rand, GROUPS.oakSmall) : pickFrom(rand, GROUPS.oakBig);
    return r < 0.55 ? pickFrom(rand, GROUPS.oakBig) : r < 0.9 ? pickFrom(rand, GROUPS.oakSmall) : pickFrom(rand, GROUPS.pine);
  }

  /**
   * Put a prop with its footprint (anchor = bottom-left, growing right and up). Every footprint
   * tile must be free grass unless `force` (map border). Returns the anchor index or -1.
   */
  placeProp(tx: number, ty: number, key: string, force = false): number {
    const def = PROPS[key];
    const tiles: number[] = [];
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++) {
        const x = tx + dx;
        const y = ty - dy;
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
        const i = y * this.width + x;
        if (!force && (this.tiles[i] !== Tile.Grass || this.owner[i] !== -1)) return -1;
        if (force && this.owner[i] !== -1) return -1;
        tiles.push(i);
      }
    const anchor = ty * this.width + tx;
    const t = def.kind === 'tree' ? Tile.Tree : def.kind === 'rock' ? Tile.Rock : Tile.Block;
    for (const i of tiles) {
      this.tiles[i] = t;
      this.owner[i] = anchor;
    }
    this.props.set(anchor, { key, tx, ty });
    return anchor;
  }

  /** Remove a whole prop (all footprint tiles become grass). */
  removeProp(anchor: number): void {
    const p = this.props.get(anchor);
    if (!p) return;
    const def = PROPS[p.key];
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++) {
        const i = (p.ty - dy) * this.width + p.tx + dx;
        this.tiles[i] = Tile.Grass;
        this.owner[i] = -1;
      }
    this.props.delete(anchor);
  }

  /** Anchor index of the prop covering a tile, or -1. */
  propAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return -1;
    return this.owner[ty * this.width + tx];
  }

  /** Dress a camp's clearing to match who lives there, on grass around the edge (never on the road). */
  private dressCamp(campIndex: number, rand: () => number): void {
    const c = this.camps[campIndex];
    const skeletons = c.members.filter((m) => m === 'skeleton').length;
    const pool: readonly string[] = c.treasure
      ? ['arch', ...GROUPS.supplies, ...GROUPS.supplies, ...GROUPS.ruins]
      : skeletons * 2 >= c.members.length
        ? GROUPS.ruins
        : [...GROUPS.wood, ...GROUPS.stump, ...GROUPS.bush, 'firewood'];
    const count = 2 + Math.floor(rand() * 3);
    let placed = 0;
    for (let tries = 0; tries < 30 && placed < count; tries++) {
      const a = rand() * Math.PI * 2;
      const r = 3 + rand() * 0.8;
      const tx = Math.floor(c.x + Math.cos(a) * r);
      const ty = Math.floor(c.y + Math.sin(a) * r);
      const key = c.treasure && placed === 0 ? 'arch' : pickFrom(rand, pool);
      const anchor = this.placeProp(tx, ty, key);
      if (anchor >= 0) {
        this.dressing.push({ anchor, camp: campIndex });
        placed++;
      }
    }
  }

  /** A little outpost around the start: signpost, lamp, cart and supplies. */
  private dressSpawn(rand: () => number): void {
    const items = ['signpost', 'lamppost', 'cart', 'barrel', 'crate', 'sack', 'fence_0'];
    for (const key of items) {
      for (let tries = 0; tries < 20; tries++) {
        const a = rand() * Math.PI * 2;
        const r = 3 + rand() * 1.2;
        const anchor = this.placeProp(Math.floor(this.spawn.x + Math.cos(a) * r), Math.floor(this.spawn.y + Math.sin(a) * r), key);
        if (anchor >= 0) {
          this.dressing.push({ anchor, camp: -1 });
          break;
        }
      }
    }
  }

  /** Dressing must never cut a camp off: strip a camp's (and the start's) props if it does. */
  private ensureReachable(): void {
    const sx = Math.floor(this.spawn.x);
    const sy = Math.floor(this.spawn.y);
    const reach = (c: CampSpec) => findTilePath(this, sx, sy, Math.floor(c.x), Math.floor(c.y)) !== null;
    this.camps.forEach((c, i) => {
      if (reach(c)) return;
      for (const d of this.dressing) if (d.camp === i || d.camp === -1) this.removeProp(d.anchor);
    });
  }

  /** Ground detail, baked into the ground texture by the renderer. */
  private scatterDecor(rand: () => number): void {
    const { width, height } = this;
    const add = (key: string, tx: number, ty: number) =>
      this.decor.push({ key, x: (tx + 0.15 + rand() * 0.7) * TILE, y: (ty + 0.3 + rand() * 0.6) * TILE });
    const nearTree = (x: number, y: number) =>
      this.get(x - 1, y) === Tile.Tree || this.get(x + 1, y) === Tile.Tree || this.get(x, y - 1) === Tile.Tree || this.get(x, y + 1) === Tile.Tree;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const t = this.get(x, y);
        const b = this.biome[y * width + x];
        const r = rand();
        if (t === Tile.Grass) {
          if (r < 0.1) add(pickFrom(rand, GROUPS.tuft), x, y);
          else if (r < 0.17 && b.forest < 0.6) add(pickFrom(rand, GROUPS.flower), x, y);
          else if (r < 0.19) add(pickFrom(rand, GROUPS.clover), x, y);
          else if (r < 0.25 && nearTree(x, y)) add(rand() < 0.5 ? pickFrom(rand, GROUPS.mushroom) : pickFrom(rand, GROUPS.litter), x, y);
          else if (r < 0.35 && b.rocky > 0.62) add(pickFrom(rand, GROUPS.pebble), x, y);
        } else if (t === Tile.Dirt) {
          if (r < 0.04) add(pickFrom(rand, GROUPS.pebble), x, y);
          else if (r < 0.06) add('twigs', x, y);
        } else if (t === Tile.Water) {
          const shore = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)].some((n) => n !== Tile.Water);
          if (shore && r < 0.18) add(pickFrom(rand, GROUPS.reeds), x, y);
          else if (!shore && r < 0.08) add(pickFrom(rand, GROUPS.lily), x, y);
        }
      }
    }
  }

  /**
   * Scatter camps over the whole map (not too close to the spawn or to each other), then join
   * them with roads: each camp links to the nearest camp that is closer to the spawn, so the
   * roads form a tree and every camp is reachable.
   */
  private placeCamps(rand: () => number): void {
    const { width, height } = this;
    const target = Math.round((width * height) / 380);
    const spots: Array<{ x: number; y: number; dist: number }> = [];
    for (let tries = 0; tries < 3000 && spots.length < target; tries++) {
      const x = 6 + Math.floor(rand() * (width - 12)) + 0.5;
      const y = 6 + Math.floor(rand() * (height - 12)) + 0.5;
      const dist = Math.hypot(x - this.spawn.x, y - this.spawn.y);
      if (dist < 10) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < 9)) continue;
      spots.push({ x, y, dist });
    }
    spots.sort((a, b) => a.dist - b.dist);

    // Rare treasure camps: roughly one in ten, at least two, never right next to the start.
    const far = spots.map((_, i) => i).filter((i) => spots[i].dist >= 16);
    const treasure = new Set(far.filter(() => rand() < 0.1));
    for (let k = 0; treasure.size < Math.min(2, far.length) && k < 50; k++) treasure.add(far[Math.floor(rand() * far.length)]);

    spots.forEach((s, i) => {
      const isTreasure = treasure.has(i);
      const { members, levelBonus } = rollGroup(rand, campLevel(s.dist), isTreasure);
      this.clearCircle(s.x, s.y, members.length >= 4 || isTreasure ? 4.2 : 3.5);
      this.paintCircle(s.x, s.y, members.length >= 4 ? 2.4 : 1.8, Tile.Dirt);
      const anchors = [this.spawn, ...spots.slice(0, i)];
      const nearest = anchors.reduce((a, b) => (Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a));
      this.carveRoad(nearest, s, rand);
      this.camps.push({ x: s.x, y: s.y, level: campLevel(s.dist) + levelBonus, members, treasure: isTreasure });
    });
    this.camps.forEach((_, i) => this.dressCamp(i, rand));
  }

  get(tx: number, ty: number): Tile {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return Tile.Tree;
    return this.tiles[ty * this.width + tx] as Tile;
  }

  set(tx: number, ty: number, t: Tile): void {
    if (tx < 2 || ty < 2 || tx >= this.width - 2 || ty >= this.height - 2) return;
    const i = ty * this.width + tx;
    // Clearing part of a prop removes the whole prop.
    if (this.owner[i] !== -1) this.removeProp(this.owner[i]);
    this.tiles[i] = t;
  }

  isWalkable(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === Tile.Grass || t === Tile.Dirt;
  }

  /** Tiles the hero can walk up to and interact with. */
  isSearchable(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === Tile.Rock || t === Tile.Chest;
  }

  /** Projectiles fly over water and rocks but not through trees. */
  blocksProjectiles(tx: number, ty: number): boolean {
    return this.get(tx, ty) === Tile.Tree;
  }

  private clearCircle(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && !this.isWalkable(x, y)) this.set(x, y, Tile.Grass);
  }

  private paintCircle(cx: number, cy: number, r: number, t: Tile): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, t);
  }

  /** Wobbly road between two points, clearing obstacles on the way so every camp is reachable. */
  private carveRoad(a: Point, b: Point, rand: () => number): void {
    let x = a.x;
    let y = a.y;
    for (let guard = 0; guard < 400; guard++) {
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d < 1) break;
      const wobble = (rand() - 0.5) * 1.2;
      x += dx / d + (-dy / d) * wobble * 0.5;
      y += dy / d + (dx / d) * wobble * 0.5;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) if (!this.isWalkable(tx + ox, ty + oy)) this.set(tx + ox, ty + oy, Tile.Grass);
      this.set(tx, ty, Tile.Dirt);
      if (rand() < 0.5) this.set(tx + 1, ty, Tile.Dirt);
    }
  }

  /** Sanity check used by tests: every camp is reachable from spawn. */
  allCampsReachable(): boolean {
    const sx = Math.floor(this.spawn.x);
    const sy = Math.floor(this.spawn.y);
    // The centre tile of a treasure camp holds the chest, so aim for the tile below it.
    return this.camps.every((c) => findTilePath(this, sx, sy, Math.floor(c.x), Math.floor(c.y) + (c.treasure ? 1 : 0)) !== null);
  }
}
