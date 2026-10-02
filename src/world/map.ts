import { Grid, Point, findTilePath } from './pathfinding';

export const TILE = 16;

export enum Tile {
  Grass = 0,
  Dirt = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
}

export interface CampSpec {
  /** tile-space centre */
  x: number;
  y: number;
  kind: 'skeletons' | 'boars';
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
        else if (rand() < 0.012) t = Tile.Rock;
        else if (rand() < 0.01) t = Tile.Tree;
        this.tiles[i] = t;
      }
    }

    this.spawn = { x: Math.floor(width / 2) + 0.5, y: Math.floor(height / 2) + 0.5 };
    this.clearCircle(this.spawn.x, this.spawn.y, 4);
    this.paintCircle(this.spawn.x, this.spawn.y, 2.2, Tile.Dirt);

    // Creep camps spread around the spawn, every one connected by a dirt road.
    const ringSpots = 7;
    for (let k = 0; k < ringSpots; k++) {
      const ang = (k / ringSpots) * Math.PI * 2 + rand() * 0.4;
      const dist = 14 + rand() * 12;
      const cx = Math.round(this.spawn.x + Math.cos(ang) * dist);
      const cy = Math.round(this.spawn.y + Math.sin(ang) * dist);
      if (cx < 5 || cy < 5 || cx > width - 6 || cy > height - 6) continue;
      this.clearCircle(cx, cy, 3.5);
      this.paintCircle(cx, cy, 1.8, Tile.Dirt);
      this.carveRoad(this.spawn, { x: cx + 0.5, y: cy + 0.5 }, rand);
      this.camps.push({ x: cx + 0.5, y: cy + 0.5, kind: dist > 22 ? 'boars' : 'skeletons' });
    }
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
    return this.camps.every((c) => findTilePath(this, sx, sy, Math.floor(c.x), Math.floor(c.y)) !== null);
  }
}
