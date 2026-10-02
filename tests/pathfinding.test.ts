import { describe, expect, it } from 'vitest';
import { Grid, findTilePath, hasLineOfWalk, nearestWalkable, planPath } from '../src/world/pathfinding';

function grid(rows: string[]): Grid {
  return {
    width: rows[0].length,
    height: rows.length,
    isWalkable: (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[0].length && rows[y][x] === '.',
  };
}

describe('findTilePath', () => {
  it('walks around a wall', () => {
    const g = grid([
      '.....',
      '.###.',
      '.#...',
      '.#.#.',
      '...#.',
    ]);
    const p = findTilePath(g, 2, 2, 0, 0)!;
    expect(p[0]).toEqual({ x: 2, y: 2 });
    expect(p[p.length - 1]).toEqual({ x: 0, y: 0 });
    for (const t of p) expect(g.isWalkable(t.x, t.y)).toBe(true);
  });

  it('never cuts diagonally past a blocked corner', () => {
    const g = grid([
      '.#',
      '..',
    ]);
    const p = findTilePath(g, 0, 0, 1, 1)!;
    expect(p).toHaveLength(3);
  });

  it('returns null for unreachable goals', () => {
    const g = grid([
      '..#..',
      '..#..',
      '..#..',
    ]);
    expect(findTilePath(g, 0, 0, 4, 0)).toBeNull();
  });
});

describe('nearestWalkable', () => {
  it('finds the closest open tile next to a blocked click', () => {
    const g = grid([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
    const n = nearestWalkable(g, 2, 2)!;
    expect(g.isWalkable(n.x, n.y)).toBe(true);
    expect(Math.max(Math.abs(n.x - 2), Math.abs(n.y - 2))).toBe(2);
  });
});

describe('planPath', () => {
  it('goes straight across open ground (one waypoint)', () => {
    const g = grid(['........', '........', '........', '........']);
    const p = planPath(g, { x: 0.5, y: 0.5 }, { x: 7.2, y: 3.4 })!;
    expect(p).toEqual([{ x: 7.2, y: 3.4 }]);
  });

  it('string-pulls a path around an obstacle to just a few waypoints', () => {
    const g = grid([
      '..........',
      '..........',
      '....##....',
      '....##....',
      '....##....',
      '..........',
    ]);
    const p = planPath(g, { x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 })!;
    expect(p.length).toBeLessThanOrEqual(3);
    let prev = { x: 1.5, y: 3.5 };
    for (const q of p) {
      expect(hasLineOfWalk(g, prev, q)).toBe(true);
      prev = q;
    }
    expect(p[p.length - 1]).toEqual({ x: 8.5, y: 3.5 });
  });

  it('redirects a click on an obstacle to a walkable spot', () => {
    const g = grid(['.....', '..#..', '.....']);
    const p = planPath(g, { x: 0.5, y: 0.5 }, { x: 2.5, y: 1.5 })!;
    const end = p[p.length - 1];
    expect(g.isWalkable(Math.floor(end.x), Math.floor(end.y))).toBe(true);
  });
});
