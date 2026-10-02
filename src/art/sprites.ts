import type Phaser from 'phaser';
import { Palette, drawRows, makeCanvas, px, shade } from './pixel';
import { TILE, Tile, WorldMap } from '../world/map';

/**
 * All game art is generated here at boot: 16x16 humanoids with 3 facings x 4 poses,
 * terrain, props, projectiles and HUD icons. Palette swaps turn the ranger into goblins and ogres.
 */

export type Facing = 'down' | 'up' | 'side';
export const FACINGS: Facing[] = ['down', 'up', 'side'];
/** Frames every unit atlas provides, named `${facing}_${pose}`. Side frames face right; the game mirrors them. */
export const POSES = ['idle', 'walk1', 'walk2', 'attack', 'shoot', 'death'] as const;
export type Pose = (typeof POSES)[number];

/** Unit atlases sliced from art-source/sprite-sheet.png by tools/slice_sheet.py. */
export const UNIT_SHEETS = ['archer', 'boar', 'skeleton', 'boar_alpha'] as const;

export function registerUnitAnims(scene: Phaser.Scene): void {
  for (const key of UNIT_SHEETS) {
    for (const f of FACINGS) {
      scene.anims.create({
        key: `${key}_walk_${f}`,
        frames: [
          { key, frame: `${f}_walk1` },
          { key, frame: `${f}_idle` },
          { key, frame: `${f}_walk2` },
          { key, frame: `${f}_idle` },
        ],
        frameRate: 7,
        repeat: -1,
      });
    }
  }
}

const OUTLINE = '#1a1c2c';

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

  // Soft pixel ellipse, 20x6; units scale it to their body radius.
  const [sc, sctx] = makeCanvas(20, 6);
  sctx.fillStyle = 'rgba(0,0,0,0.32)';
  for (let y = 0; y < 6; y++) {
    const half = Math.round(10 * Math.sqrt(1 - ((y + 0.5 - 3) / 3) ** 2));
    sctx.fillRect(10 - half, y, half * 2, 1);
  }
  scene.textures.addCanvas('shadow', sc);

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

/** Hero portrait for the HUD: the head and shoulders of the archer's idle frame. */
/** Hero portrait for the HUD: head and shoulders cropped from the archer's idle frame. */
export function portraitDataUrl(scene: Phaser.Scene, scale = 4): string {
  const frame = scene.textures.getFrame('archer', 'down_idle');
  const [probe, pctx] = makeCanvas(frame.width, frame.height);
  pctx.drawImage(frame.source.image as HTMLImageElement, frame.cutX, frame.cutY, frame.width, frame.height, 0, 0, frame.width, frame.height);
  const data = pctx.getImageData(0, 0, frame.width, frame.height).data;
  const opaque = (x: number, y: number) => data[(y * frame.width + x) * 4 + 3] > 0;
  // Bounding box of the head: the first opaque rows of the sprite.
  let top = 0;
  while (top < frame.height - 1 && !Array.from({ length: frame.width }, (_, x) => opaque(x, top)).some(Boolean)) top++;
  let minX = frame.width;
  let maxX = 0;
  for (let y = top; y < Math.min(frame.height, top + 8); y++)
    for (let x = 0; x < frame.width; x++) if (opaque(x, y)) [minX, maxX] = [Math.min(minX, x), Math.max(maxX, x)];
  const w = 20;
  const h = 15;
  const sx = Math.round((minX + maxX + 1) / 2 - w / 2);
  const [c, ctx] = makeCanvas(w * scale, h * scale);
  ctx.fillStyle = '#20301f';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(probe, sx, top - 1, w, h, 0, 0, w * scale, h * scale);
  return c.toDataURL();
}

export function buildAllTextures(scene: Phaser.Scene, map: WorldMap): void {
  registerUnitAnims(scene);
  buildGround(scene, map);
  buildProps(scene);
}
