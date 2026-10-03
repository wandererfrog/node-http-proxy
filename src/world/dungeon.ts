/**
 * Random dungeon layouts: rooms joined by corridors, the classic way.
 *
 *  1. Scatter non-overlapping rooms (with a wall margin between them). A room is a plain hall, a
 *     pillared hall, or a cave (a noisy ellipse).
 *  2. Join the rooms with a minimum spanning tree over their centres, plus a few extra links so
 *     there are loops (no single dead-end chain). Corridors are L-shaped and two tiles wide.
 *  3. The start room is the one nearest a random corner; the boss room is the one farthest from it
 *     by walking distance.
 *
 * Pure layout (no art, no creeps): WorldMap turns it into tiles, props and camps.
 */

export type RoomShape = 'hall' | 'pillars' | 'cave';

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: RoomShape;
}

export interface DungeonLayout {
  width: number;
  height: number;
  /** 1 = floor, 0 = wall. */
  floor: Uint8Array;
  rooms: Room[];
  start: number;
  boss: number;
  /** Walking distance (tiles) from the start room's centre to each room's centre. */
  distance: number[];
}

export const roomCentre = (r: Room) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });

export function layoutDungeon(rand: () => number, width: number, height: number, maxRooms = 11): DungeonLayout {
  const floor = new Uint8Array(width * height);
  const carve = (x: number, y: number) => {
    if (x >= 2 && y >= 2 && x < width - 2 && y < height - 2) floor[y * width + x] = 1;
  };

  // 1. Rooms.
  const rooms: Room[] = [];
  for (let tries = 0; tries < 400 && rooms.length < maxRooms; tries++) {
    const w = 8 + Math.floor(rand() * 7);
    const h = 7 + Math.floor(rand() * 5);
    const x = 3 + Math.floor(rand() * (width - w - 6));
    const y = 3 + Math.floor(rand() * (height - h - 6));
    if (rooms.some((r) => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
    const s = rand();
    rooms.push({ x, y, w, h, shape: s < 0.22 ? 'cave' : s < 0.45 ? 'pillars' : 'hall' });
  }
  for (const r of rooms) {
    if (r.shape === 'cave') {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const dx = (x + 0.5 - cx) / (r.w / 2);
          const dy = (y + 0.5 - cy) / (r.h / 2);
          if (dx * dx + dy * dy <= 0.85 + (rand() - 0.5) * 0.3) carve(x, y);
        }
      // Keep the middle open so the room is one piece.
      for (let y = Math.floor(cy) - 1; y <= Math.floor(cy) + 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) carve(x, y);
      for (let x = Math.floor(cx) - 1; x <= Math.floor(cx) + 1; x++) for (let y = r.y + 1; y < r.y + r.h - 1; y++) carve(x, y);
    } else {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y);
    }
  }

  // 2. Corridors: a minimum spanning tree (Prim) plus a few extra links for loops.
  const centres = rooms.map(roomCentre);
  const d = (a: number, b: number) => Math.hypot(centres[a].x - centres[b].x, centres[a].y - centres[b].y);
  const inTree = new Set<number>([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null;
    for (const a of inTree)
      for (let b = 0; b < rooms.length; b++) if (!inTree.has(b) && (!best || d(a, b) < d(best[0], best[1]))) best = [a, b];
    edges.push(best!);
    inTree.add(best![1]);
  }
  for (let k = 0; k < 3; k++) {
    const a = Math.floor(rand() * rooms.length);
    let b = -1;
    for (let j = 0; j < rooms.length; j++) {
      if (j === a || edges.some(([p, q]) => (p === a && q === j) || (p === j && q === a))) continue;
      if (b < 0 || d(a, j) < d(a, b)) b = j;
    }
    if (b >= 0 && d(a, b) < 26) edges.push([a, b]);
  }
  // Two tiles wide: a horizontal run covers rows y and y+1, a vertical run columns x and x+1.
  const hline = (x0: number, x1: number, y: number) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++) {
      carve(x, y);
      carve(x, y + 1);
    }
  };
  const vline = (y0: number, y1: number, x: number) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++) {
      carve(x, y);
      carve(x + 1, y);
    }
  };
  for (const [a, b] of edges) {
    const p = centres[a];
    const q = centres[b];
    if (rand() < 0.5) {
      hline(p.x, q.x, p.y);
      vline(p.y, q.y, q.x);
    } else {
      vline(p.y, q.y, p.x);
      hline(p.x, q.x, q.y);
    }
  }

  // 3. Start (nearest a random corner) and boss (farthest walk from the start).
  const corner = { x: rand() < 0.5 ? 0 : width, y: rand() < 0.5 ? 0 : height };
  let start = 0;
  centres.forEach((c, i) => {
    if (Math.hypot(c.x - corner.x, c.y - corner.y) < Math.hypot(centres[start].x - corner.x, centres[start].y - corner.y)) start = i;
  });
  const dist = walkDistances(floor, width, height, centres[start].x, centres[start].y);
  const distance = centres.map((c) => dist[c.y * width + c.x]);
  let boss = start;
  distance.forEach((v, i) => {
    if (v > distance[boss]) boss = i;
  });
  return { width, height, floor, rooms, start, boss, distance };
}

/** Breadth-first walking distance over floor tiles (4-way); -1 where unreachable. */
export function walkDistances(floor: Uint8Array, width: number, height: number, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(width * height).fill(-1);
  const queue = [sy * width + sx];
  dist[queue[0]] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % width;
    const y = (i / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!floor[n] || dist[n] >= 0) continue;
      dist[n] = dist[i] + 1;
      queue.push(n);
    }
  }
  return dist;
}
