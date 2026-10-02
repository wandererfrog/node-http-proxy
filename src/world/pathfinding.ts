/**
 * Grid pathfinding for click-to-move.
 *
 * - 8-directional A* with an octile heuristic. Diagonal moves are not allowed
 *   past a blocked corner, so units never clip through tree/rock corners.
 * - The raw tile path gets string-pulled with line-of-sight checks, so units
 *   walk in straight lines across open ground instead of zig-zagging tile by tile.
 * - If the clicked tile is blocked, the target becomes the closest reachable
 *   walkable tile, which is what Warcraft III does when you click on a tree.
 */

export interface Grid {
  readonly width: number;
  readonly height: number;
  /** true = walkable */
  isWalkable(tx: number, ty: number): boolean;
}

export interface Point {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** Minimal binary min-heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(n: number): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function canStep(grid: Grid, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) return false;
  if (!grid.isWalkable(nx, ny)) return false;
  // No corner cutting.
  if (dx !== 0 && dy !== 0) {
    if (!grid.isWalkable(x + dx, y) || !grid.isWalkable(x, y + dy)) return false;
  }
  return true;
}

/**
 * A* over tiles. Returns the tile path from start to goal, both included, or null.
 * `maxNodes` bounds the search so a click on an unreachable island can't stall a frame.
 */
export function findTilePath(
  grid: Grid,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  maxNodes = 20000,
): Point[] | null {
  const W = grid.width;
  const H = grid.height;
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }];
  if (!grid.isWalkable(gx, gy)) return null;

  const N = W * H;
  const g = new Float64Array(N).fill(Infinity);
  const f = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap(f);

  const start = sy * W + sx;
  const goal = gy * W + gx;
  g[start] = 0;
  f[start] = octile(sx, sy, gx, gy);
  open.push(start);

  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    for (const [dx, dy, cost] of DIRS) {
      if (!canStep(grid, cx, cy, dx, dy)) continue;
      const n = (cy + dy) * W + (cx + dx);
      if (closed[n]) continue;
      const ng = g[cur] + cost;
      if (ng < g[n]) {
        g[n] = ng;
        from[n] = cur;
        f[n] = ng + octile(cx + dx, cy + dy, gx, gy);
        open.push(n);
      }
    }
  }

  if (from[goal] === -1) return null;
  const path: Point[] = [];
  for (let n = goal; n !== -1; n = from[n]) path.push({ x: n % W, y: (n / W) | 0 });
  path.reverse();
  return path;
}

/** Closest walkable tile to (tx, ty), searched in rings outward. Returns null if nothing within `maxRadius`. */
export function nearestWalkable(
  grid: Grid,
  tx: number,
  ty: number,
  maxRadius = 12,
): Point | null {
  const cx = Math.max(0, Math.min(grid.width - 1, tx));
  const cy = Math.max(0, Math.min(grid.height - 1, ty));
  if (grid.isWalkable(cx, cy)) return { x: cx, y: cy };
  let best: Point | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        if (!grid.isWalkable(x, y)) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * True if a body with `radius` (in tiles) can slide from a to b (tile-space floats) without
 * touching a blocked tile. The segment is sampled densely and the body's corners are checked.
 */
export function hasLineOfWalk(grid: Grid, a: Point, b: Point, radius = 0.3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    for (const [ox, oy] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
      const tx = Math.floor(px + ox);
      const ty = Math.floor(py + oy);
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
      if (!grid.isWalkable(tx, ty)) return false;
    }
  }
  return true;
}

/**
 * String-pulling: from each waypoint, jump to the furthest later waypoint that's in direct
 * line of walk. Input and output are in tile-space floats (tile centres are x + 0.5).
 */
export function smoothPath(grid: Grid, pts: Point[], radius = 0.3): Point[] {
  if (pts.length <= 2) return pts.slice();
  const out: Point[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !hasLineOfWalk(grid, pts[i], pts[j], radius)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/**
 * Full click-to-move query in tile-space floats: from the unit's exact position to the exact
 * clicked point (or the nearest walkable fallback). Returns waypoints, excluding the start.
 */
export function planPath(grid: Grid, from: Point, to: Point, radius = 0.3): Point[] | null {
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  let gx = Math.floor(to.x);
  let gy = Math.floor(to.y);
  let goal: Point = { x: to.x, y: to.y };

  if (!grid.isWalkable(gx, gy) || !hasLineOfWalk(grid, { x: gx + 0.5, y: gy + 0.5 }, goal, radius)) {
    const nw = nearestWalkable(grid, gx, gy);
    if (!nw) return null;
    gx = nw.x;
    gy = nw.y;
    goal = { x: gx + 0.5, y: gy + 0.5 };
  }

  // Short hop with nothing in the way: walk straight there.
  if (hasLineOfWalk(grid, from, goal, radius)) return [goal];

  const tiles = findTilePath(grid, sx, sy, gx, gy);
  if (!tiles) return null;
  const pts: Point[] = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
  pts[0] = { x: from.x, y: from.y };
  pts[pts.length - 1] = goal;
  return smoothPath(grid, pts, radius).slice(1);
}
