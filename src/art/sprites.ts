import type Phaser from 'phaser';
import { Palette, drawPixels, drawRows, makeCanvas, px, shade } from './pixel';
import { TILE, Tile, WorldMap } from '../world/map';

/**
 * All game art is generated here at boot: 16x16 humanoids with 3 facings x 4 poses,
 * terrain, props, projectiles and HUD icons. Palette swaps turn the ranger into goblins and ogres.
 */

export type Facing = 'down' | 'up' | 'side';
export const FACINGS: Facing[] = ['down', 'up', 'side'];
/** Frame order per facing. */
export const POSES = ['idle', 'walk1', 'walk2', 'attack'] as const;
export type Pose = (typeof POSES)[number];

// --- Humanoid body, 16x13 upper body + 3 rows of legs ---------------------------------------

export const BODY: Record<Facing, string[]> = {
  down: [
    '......kkkk......',
    '.....kGGGGk.....',
    '....kGGGGGGk....',
    '...kGssssssGk...',
    '...kgsessesgk...',
    '...kgssSSssgk...',
    '...kggSSSSggk...',
    '..kdgGGGGGGgdk..',
    '..kdsGGbGGGsdk..',
    '..kdsGGGbGGsdk..',
    '...kdBBBBBBdk...',
    '...kdGGGGGGdk...',
    '....kGGGGGGk....',
  ],
  up: [
    '......kkkk......',
    '.....kGGGGk.....',
    '....kGGGGGGk....',
    '...kGGGGGGGGk...',
    '...kgGGGGGGgk...',
    '...kgGGGGGGgk...',
    '...kggggggggk...',
    '..kddddddddddk..',
    '..ksddddddddsk..',
    '..ksddddddddsk..',
    '...kBBBBBBBBk...',
    '...kddddddddk...',
    '....kddddddk....',
  ],
  side: [
    '.....kkkk.......',
    '....kGGGGk......',
    '...kGGGGGGk.....',
    '...kGGGGsssk....',
    '...kgGGssesk....',
    '...kggGsssssk...',
    '...kgggSSSk.....',
    '...kddGGGGGk....',
    '...kddGGGsGk....',
    '...kddGbGGsk....',
    '...kdBBBBBBk....',
    '...kdGGGGGk.....',
    '....kGGGGk......',
  ],
};

export const LEGS: Record<Facing, Record<'idle' | 'walk1' | 'walk2', string[]>> = {
  down: {
    idle: ['....kll..llk....', '....kll..llk....', '....koo..ook....'],
    walk1: ['....kll..llk....', '....kll...kk....', '....koo.........'],
    walk2: ['....kll..llk....', '....kk...llk....', '.........ook....'],
  },
  up: {
    idle: ['....kll..llk....', '....kll..llk....', '....koo..ook....'],
    walk1: ['....kll..llk....', '....kll...kk....', '....koo.........'],
    walk2: ['....kll..llk....', '....kk...llk....', '.........ook....'],
  },
  side: {
    idle: ['.....kllk.......', '.....kllk.......', '.....koook......'],
    walk1: ['....kll.llk.....', '...kll...llk....', '..koo.....ook...'],
    walk2: ['.....kllk.......', '.....klk........', '.....kook.......'],
  },
};

type Px = ReadonlyArray<readonly [number, number, string]>;
type WeaponArt = Record<Facing, { idle: Px; attack: Px }>;

const line = (x0: number, y0: number, x1: number, y1: number, ch: string): [number, number, string][] => {
  const out: [number, number, string][] = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    out.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), ch]);
  }
  return out;
};

const BOW: WeaponArt = {
  side: {
    idle: [
      [12, 3, 'B'], [13, 4, 'b'], ...line(14, 5, 14, 9, 'b'), [13, 10, 'b'], [12, 11, 'B'],
      ...line(12, 4, 12, 10, 'w'), [13, 7, 's'],
    ],
    attack: [
      [12, 3, 'B'], [13, 4, 'b'], ...line(14, 5, 14, 9, 'b'), [13, 10, 'b'], [12, 11, 'B'],
      ...line(12, 4, 9, 7, 'w'), ...line(9, 7, 12, 10, 'w'),
      ...line(9, 7, 14, 7, 'a'), [15, 7, 'm'], [8, 7, 'r'], [13, 7, 's'],
    ],
  },
  down: {
    idle: [[14, 6, 'B'], ...line(15, 7, 15, 10, 'b'), [14, 11, 'B'], ...line(14, 7, 14, 10, 'w')],
    attack: [
      [3, 11, 'B'], ...line(4, 12, 11, 12, 'b'), [12, 11, 'B'],
      ...line(4, 11, 7, 9, 'w'), ...line(8, 9, 11, 11, 'w'),
      ...line(7, 9, 7, 14, 'a'), [7, 15, 'm'],
    ],
  },
  up: {
    idle: [[10, 4, 'r'], [11, 5, 'r'], ...line(10, 5, 10, 9, 'B'), ...line(11, 6, 11, 9, 'B')],
    attack: [
      [10, 4, 'r'], [11, 5, 'r'],
      [3, 4, 'B'], ...line(4, 3, 11, 3, 'b'), [12, 4, 'B'],
      ...line(7, 0, 7, 5, 'a'), [7, 0, 'm'],
    ],
  },
};

const CLUB: WeaponArt = {
  side: {
    idle: [...line(12, 8, 14, 4, 'b'), [14, 3, 'B'], [15, 3, 'B'], [15, 4, 'B'], [12, 8, 's']],
    attack: [...line(11, 8, 14, 8, 'b'), [15, 7, 'B'], [15, 8, 'B'], [15, 9, 'B'], [11, 8, 's']],
  },
  down: {
    idle: [...line(14, 9, 14, 5, 'b'), [14, 4, 'B'], [15, 4, 'B'], [15, 5, 'B']],
    attack: [...line(8, 9, 8, 13, 'b'), [7, 14, 'B'], [8, 14, 'B'], [9, 14, 'B'], [8, 15, 'B']],
  },
  up: {
    idle: [...line(1, 9, 1, 5, 'b'), [0, 4, 'B'], [1, 4, 'B'], [0, 5, 'B']],
    attack: [...line(8, 5, 8, 2, 'b'), [7, 1, 'B'], [8, 1, 'B'], [9, 1, 'B'], [8, 0, 'B']],
  },
};

const OUTLINE = '#1a1c2c';

export const PALETTES: Record<string, Palette> = {
  ranger: {
    k: OUTLINE, G: '#4f9a4a', g: '#2e5c35', d: '#23452a', s: '#f0b98d', S: '#c98b62', e: OUTLINE,
    b: '#9a5f33', B: '#5c3a22', l: '#5a4636', o: '#3b2a20', w: '#e6e6e6', a: '#c8a070', m: '#c0c8d0', r: '#c0392b',
  },
  goblin: {
    k: OUTLINE, G: '#8a5a35', g: '#5c3a22', d: '#6b4a2a', s: '#7bbf4a', S: '#4f8a33', e: '#ff3b30',
    b: '#8d6e4f', B: '#5a5a66', l: '#4a3a2a', o: '#2a2018', w: '#e6e6e6', a: '#c8a070', m: '#c0c8d0', r: '#c0392b',
  },
  ogre: {
    k: OUTLINE, G: '#7a6a9a', g: '#4d3f6b', d: '#3d3354', s: '#9fb0a0', S: '#6f8070', e: '#ffcc00',
    b: '#7d5a3a', B: '#3a3a44', l: '#4a3a2a', o: '#2a2018', w: '#e6e6e6', a: '#c8a070', m: '#c0c8d0', r: '#c0392b',
  },
};

export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  facing: Facing,
  pose: Pose,
  pal: Palette,
  weapon: WeaponArt,
  ox = 0,
  oy = 0,
): void {
  const legs = LEGS[facing][pose === 'attack' ? 'idle' : pose];
  // The weapon goes behind the body when facing up, in front otherwise.
  const w = weapon[facing][pose === 'attack' ? 'attack' : 'idle'];
  if (facing === 'up') drawPixels(ctx, w, pal, ox, oy);
  drawRows(ctx, BODY[facing], pal, ox, oy);
  drawRows(ctx, legs, pal, ox, oy + 13);
  if (facing !== 'up') drawPixels(ctx, w, pal, ox, oy);
}

/** Build a 16x16 spritesheet texture `key` with frames `${key}_${facing}_${pose}`. */
function buildUnitSheet(scene: Phaser.Scene, key: string, pal: Palette, weapon: WeaponArt): void {
  const [canvas, ctx] = makeCanvas(16 * POSES.length, 16 * FACINGS.length);
  FACINGS.forEach((f, row) => POSES.forEach((p, col) => drawHumanoid(ctx, f, p, pal, weapon, col * 16, row * 16)));
  const tex = scene.textures.addCanvas(key, canvas)!;
  FACINGS.forEach((f, row) =>
    POSES.forEach((p, col) => tex.add(`${f}_${p}`, 0, col * 16, row * 16, 16, 16)),
  );
  for (const f of FACINGS) {
    scene.anims.create({
      key: `${key}_walk_${f}`,
      frames: [
        { key, frame: `${f}_walk1` },
        { key, frame: `${f}_idle` },
        { key, frame: `${f}_walk2` },
        { key, frame: `${f}_idle` },
      ],
      frameRate: 8,
      repeat: -1,
    });
  }
}

// --- Terrain ---------------------------------------------------------------------------------

const GRASS = '#5aa04a';
const GRASS_SPECKLE = ['#529846', '#62a852', '#55a04a'];
const GRASS_DARK = '#3f7d36';
const DIRT = '#b48a5a';
const DIRT_DARK = '#9a7248';
const WATER = '#3a74c4';
const WATER_LIGHT = '#6aa6e8';

function hash(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bake the whole ground layer (grass/dirt/water and their edges) into one canvas. */
function buildGround(scene: Phaser.Scene, map: WorldMap): void {
  const [canvas, ctx] = makeCanvas(map.width * TILE, map.height * TILE);
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const i = ty * map.width + tx;
      const t = map.get(tx, ty);
      const v = map.variant[i];
      const X = tx * TILE;
      const Y = ty * TILE;
      if (t === Tile.Water) {
        px(ctx, X, Y, WATER, TILE, TILE);
        for (let k = 0; k < 3; k++) {
          const wx = Math.floor(hash(i, k) * 12);
          const wy = Math.floor(hash(i, k + 7) * 14);
          px(ctx, X + wx, Y + wy, WATER_LIGHT, 3, 1);
        }
        continue;
      }
      if (t === Tile.Dirt) {
        px(ctx, X, Y, DIRT, TILE, TILE);
        for (let k = 0; k < 6; k++) px(ctx, X + Math.floor(hash(i, k) * 15), Y + Math.floor(hash(i, k + 9) * 15), DIRT_DARK, 2, 1);
        continue;
      }
      // Grass (also under trees and rocks). One base colour plus speckles so tiles don't read as a grid.
      px(ctx, X, Y, GRASS, TILE, TILE);
      for (let k = 0; k < 14; k++) {
        px(ctx, X + Math.floor(hash(i, k + 40) * 16), Y + Math.floor(hash(i, k + 60) * 16), GRASS_SPECKLE[k % 3], 2, 1);
      }
      for (let k = 0; k < 5; k++) {
        const gx = X + Math.floor(hash(i, k) * 14);
        const gy = Y + Math.floor(hash(i, k + 5) * 14) + 1;
        px(ctx, gx, gy, GRASS_DARK, 1, 2);
        px(ctx, gx + 1, gy + 1, GRASS_DARK);
      }
      if (v % 13 === 0) {
        const fx = X + 3 + (v % 9);
        const fy = Y + 3 + ((v >> 3) % 9);
        const petal = ['#f4f4f4', '#ffd84a', '#e86a8a'][v % 3];
        px(ctx, fx - 1, fy, petal); px(ctx, fx + 1, fy, petal); px(ctx, fx, fy - 1, petal); px(ctx, fx, fy + 1, petal);
        px(ctx, fx, fy, '#f5b833');
      }
    }
  }
  // Ragged road edges: let grass bite into dirt tiles along borders so roads aren't square.
  const isDirt = (x: number, y: number) => map.get(x, y) === Tile.Dirt;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (!isDirt(tx, ty)) continue;
      const i = ty * map.width + tx;
      const X = tx * TILE;
      const Y = ty * TILE;
      for (let k = 0; k < TILE; k++) {
        const d = 1 + Math.floor(hash(i, k) * 3);
        if (!isDirt(tx, ty - 1) && map.get(tx, ty - 1) !== Tile.Water) px(ctx, X + k, Y, GRASS, 1, d);
        if (!isDirt(tx, ty + 1) && map.get(tx, ty + 1) !== Tile.Water) px(ctx, X + k, Y + TILE - d, GRASS, 1, d);
        const e = 1 + Math.floor(hash(i, k + 20) * 3);
        if (!isDirt(tx - 1, ty) && map.get(tx - 1, ty) !== Tile.Water) px(ctx, X, Y + k, GRASS, e, 1);
        if (!isDirt(tx + 1, ty) && map.get(tx + 1, ty) !== Tile.Water) px(ctx, X + TILE - e, Y + k, GRASS, e, 1);
      }
    }
  }
  // Shorelines.
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.get(tx, ty);
      if (t !== Tile.Water) continue;
      const X = tx * TILE;
      const Y = ty * TILE;
      if (map.get(tx, ty - 1) !== Tile.Water) px(ctx, X, Y, '#2d5f9e', TILE, 2);
      if (map.get(tx, ty + 1) !== Tile.Water) px(ctx, X, Y + TILE - 1, '#8fc4f0', TILE, 1);
      if (map.get(tx - 1, ty) !== Tile.Water) px(ctx, X, Y, '#2d5f9e', 1, TILE);
      if (map.get(tx + 1, ty) !== Tile.Water) px(ctx, X + TILE - 1, Y, '#2d5f9e', 1, TILE);
    }
  }
  scene.textures.addCanvas('ground', canvas);
}

function buildProps(scene: Phaser.Scene): void {
  // Tree: 16x24, trunk at the bottom so it sorts nicely against units.
  for (let v = 0; v < 3; v++) {
    const [c, ctx] = makeCanvas(16, 24);
    const base = ['#2f6b34', '#2a6230', '#357a3a'][v];
    const light = shade(base, 0.35);
    const dark = shade(base, -0.35);
    drawRows(ctx, [
      '......kkkk......',
      '....kkddddkk....',
      '...kdLLddddLk...',
      '..kdLLLddddddk..',
      '..kdLLddddddDk..',
      '.kddLddddddddDk.',
      '.kdddddLLdddDDk.',
      '.kdddddLLddddDk.',
      '.kddddddddddDDk.',
      'kdLLdddddddDDDDk',
      'kdLLddddddddDDDk',
      'kddddddLdddddDDk',
      '.kddddddddddDDk.',
      '.kDdddddddDDDDk.',
      '..kDDDddDDDDDk..',
      '...kkDDDDDDkk...',
      '.....kkTTkk.....',
      '......kTTk......',
      '......kTtk......',
      '......kTtk......',
      '.....kTTtTk.....',
      '.....kkkkkk.....',
    ], { k: OUTLINE, d: base, L: light, D: dark, T: '#6b4a2a', t: '#4e3520' }, 0, 2);
    scene.textures.addCanvas(`tree${v}`, c);
  }

  const [rc, rctx] = makeCanvas(16, 16);
  drawRows(rctx, [
    '................',
    '................',
    '................',
    '................',
    '.....kkkkk......',
    '...kkLLLmmkk....',
    '..kLLLmmmmmmk...',
    '..kLmmmmmmmmDk..',
    '.kLmmmmmmmmmDk..',
    '.kmmmmmmmmmDDk..',
    '.kmmmmmmmmDDDDk.',
    '.kDmmmmmmDDDDDk.',
    '..kDDDDDDDDDDk..',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ], { k: OUTLINE, L: '#c8ccd4', m: '#9aa0ac', D: '#6c7180' });
  scene.textures.addCanvas('rock', rc);

  const [sc, sctx] = makeCanvas(12, 5);
  sctx.fillStyle = 'rgba(0,0,0,0.35)';
  sctx.fillRect(2, 0, 8, 5);
  sctx.fillRect(0, 1, 12, 3);
  scene.textures.addCanvas('shadow', sc);

  const [ac, actx] = makeCanvas(9, 3);
  drawRows(actx, ['rr.......', '.raaaaaam', 'rr.......'], { r: '#e6e6e6', a: '#c8a070', m: '#d8dee6' });
  scene.textures.addCanvas('arrow', ac);

  const [fc, fctx] = makeCanvas(9, 3);
  drawRows(fctx, ['yy....ooy', '.yaaaoooY', 'yy....ooy'], { y: '#ffd84a', a: '#ff9a3a', o: '#ff5a1f', Y: '#fff2a8' });
  scene.textures.addCanvas('arrow_fire', fc);

  const [pc, pctx] = makeCanvas(3, 3);
  drawRows(pctx, ['.w.', 'www', '.w.'], { w: '#ffffff' });
  scene.textures.addCanvas('spark', pc);

  // Ground-target reticle and range ring are drawn with Graphics; this is the camp campfire.
  const [cc, cctx] = makeCanvas(16, 16);
  drawRows(cctx, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...kbbk..kbbk...',
    '..kbbbbkkbbbbk..',
    '...kkbbbbbbkk...',
    '....kbbkkbbk....',
    '.....kk..kk.....',
    '................',
  ], { k: OUTLINE, b: '#7a5232' });
  scene.textures.addCanvas('logs', cc);
}

// --- HUD icons -------------------------------------------------------------------------------

const ICONS: Record<string, { rows: string[]; pal: Palette; bg: string }> = {
  searing: {
    bg: '#3a1a10',
    pal: { y: '#ffd84a', o: '#ff7a1f', r: '#d0301a', a: '#c8a070', w: '#fff2a8' },
    rows: [
      '................',
      '...........yy...',
      '..........yoy...',
      '.........yoory..',
      '........yoory...',
      '.......aory.....',
      '......aay.......',
      '.....aa.........',
      '....aa..........',
      '...aa...........',
      '.waa............',
      'ww..............',
      '.w..............',
      '................',
      '................',
      '................',
    ],
  },
  volley: {
    bg: '#14243a',
    pal: { a: '#c8a070', m: '#d8dee6', w: '#ffffff' },
    rows: [
      '.............m..',
      '...m........a...',
      '....a......a....',
      '.....a....a.....',
      '......a..a......',
      '.......aa.......',
      '..m.....a.....m.',
      '...aa...a...aa..',
      '.....aa.a.aa....',
      '.......aaa......',
      '........a.......',
      '.......www......',
      '......w.w.w.....',
      '................',
      '................',
      '................',
    ],
  },
  tumble: {
    bg: '#1c2f1c',
    pal: { g: '#7bd36a', G: '#4f9a4a', w: '#ffffff' },
    rows: [
      '................',
      '.....gggg.......',
      '...gg....gg.....',
      '..g........g....',
      '..g..GGG....g...',
      '.g..G...G...g...',
      '.g..G....G..g...',
      '.g...G...G..g...',
      '.....G..G..g....',
      '..ww..GG..g.....',
      '.wwwwwww.g......',
      '..ww.....gggggg.',
      '...........gggg.',
      '............gg..',
      '................',
      '................',
    ],
  },
  rain: {
    bg: '#2a1838',
    pal: { a: '#c8a070', m: '#d8dee6', p: '#c28cff' },
    rows: [
      '..a.....a....a..',
      '..a..a..a..a.a..',
      '..m..a..m..a.m..',
      '.....a.....a....',
      '.a...m..a..m..a.',
      '.a......a.....a.',
      '.m..a...m..a..m.',
      '....a......a....',
      '....m..a...m....',
      '.......a........',
      '...a...m...a....',
      '...a.......a....',
      '...m.......m....',
      '..pppppppppppp..',
      '.pppppppppppppp.',
      '................',
    ],
  },
  attack: {
    bg: '#3a1414',
    pal: { m: '#d8dee6', D: '#8a92a0', b: '#7a5232', y: '#ffd84a' },
    rows: [
      '................',
      '............mm..',
      '...........mmD..',
      '..........mmD...',
      '.........mmD....',
      '........mmD.....',
      '.......mmD......',
      '..y...mmD.......',
      '...y.mmD........',
      '....yyD.........',
      '....byy.........',
      '...b...y........',
      '..b.............',
      '.b..............',
      '................',
      '................',
    ],
  },
  stop: {
    bg: '#2a2a2a',
    pal: { r: '#d0301a', w: '#ffffff', k: '#7a1a10' },
    rows: [
      '................',
      '.....rrrrrr.....',
      '....rrrrrrrr....',
      '...rrrrrrrrrr...',
      '..rrrrrrrrrrrr..',
      '..rrrrrrrrrrrr..',
      '..rwwwwwwwwwwr..',
      '..rwwwwwwwwwwr..',
      '..rrrrrrrrrrrr..',
      '..rrrrrrrrrrrr..',
      '...rrrrrrrrrr...',
      '....rrrrrrrr....',
      '.....rrrrrr.....',
      '................',
      '................',
      '................',
    ],
  },
  hold: {
    bg: '#1f2a3a',
    pal: { s: '#9aa0ac', S: '#c8ccd4', y: '#ffd84a', k: '#3a3f4a' },
    rows: [
      '................',
      '...kkkkkkkkkk...',
      '...kSSSSssssk...',
      '...kSSSSssssk...',
      '...kSSyyyyssk...',
      '...kSSyyyyssk...',
      '...kSSSSssssk...',
      '...kSSSSssssk...',
      '....kSSSsssk....',
      '....kSSSsssk....',
      '.....kSSssk.....',
      '......kssk......',
      '.......kk.......',
      '................',
      '................',
      '................',
    ],
  },
};

/** Icons are data URLs so the DOM HUD can use them directly. */
export function iconDataUrl(name: string, scale = 4): string {
  const icon = ICONS[name];
  const [c, ctx] = makeCanvas(16 * scale, 16 * scale);
  ctx.fillStyle = icon.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(scale, scale);
  drawRows(ctx, icon.rows, icon.pal);
  ctx.restore();
  return c.toDataURL();
}

export function portraitDataUrl(scale = 4): string {
  const [c, ctx] = makeCanvas(16 * scale, 12 * scale);
  ctx.fillStyle = '#20301f';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(scale, scale);
  drawRows(ctx, BODY.down.slice(0, 12), PALETTES.ranger, 0, 1);
  drawPixels(ctx, BOW.down.idle, PALETTES.ranger, 0, 1);
  ctx.restore();
  return c.toDataURL();
}

export function buildAllTextures(scene: Phaser.Scene, map: WorldMap): void {
  buildUnitSheet(scene, 'ranger', PALETTES.ranger, BOW);
  buildUnitSheet(scene, 'goblin', PALETTES.goblin, CLUB);
  buildUnitSheet(scene, 'ogre', PALETTES.ogre, CLUB);
  buildGround(scene, map);
  buildProps(scene);
}
