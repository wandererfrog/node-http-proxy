import { Grid, Point, findTilePath } from './pathfinding';
import type { CreepKind } from '../entities/balance';

export const TILE = 16;

export enum Tile {
  Grass = 0,
  Dirt = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  /** Treasure chest in the middle of a guarded camp. */
  Chest = 5,
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

export class WorldMap implements Grid {
  readonly tiles: Uint8Array;
  /** per-tile random variant for decoration (grass tufts, flowers...) */
  readonly variant: Uint8Array;
  readonly camps: CampSpec[] = [];
  readonly spawn: Point;

  constructor(readonly width: number, readonly height: number, seed = 1337) {
    this.tiles = new Uint8Array(width * height);
    this.variant = new Uint8Array(width * height);
    const rand = mulberry32(seed);
    const forest = makeNoise(rand, 64);
    const lakes = makeNoise(rand, 64);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        this.variant[i] = Math.floor(rand() * 256);
        const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
        const f = forest(x / 7, y / 7) + forest(x / 3, y / 3) * 0.35;
        const w = lakes(x / 9 + 100, y / 9 + 100);
        let t: Tile = Tile.Grass;
        if (edge < 2) t = Tile.Tree;
        else if (w > 0.78) t = Tile.Water;
        else if (f > 1.0) t = Tile.Tree;
        else if (rand() < 0.015) t = Tile.Rock;
        else if (rand() < 0.01) t = Tile.Tree;
        this.tiles[i] = t;
      }
    }

    this.spawn = { x: Math.floor(width / 2) + 0.5, y: Math.floor(height / 2) + 0.5 };
    this.clearCircle(this.spawn.x, this.spawn.y, 4);
    this.paintCircle(this.spawn.x, this.spawn.y, 2.2, Tile.Dirt);

    this.placeCamps(rand);
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
    // Chests go in last so no later road clears them away.
    for (const c of this.camps) if (c.treasure) this.set(Math.floor(c.x), Math.floor(c.y), Tile.Chest);
  }

  get(tx: number, ty: number): Tile {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return Tile.Tree;
    return this.tiles[ty * this.width + tx] as Tile;
  }

  set(tx: number, ty: number, t: Tile): void {
    if (tx < 2 || ty < 2 || tx >= this.width - 2 || ty >= this.height - 2) return;
    this.tiles[ty * this.width + tx] = t;
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
