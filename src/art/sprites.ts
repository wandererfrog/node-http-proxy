import type Phaser from 'phaser';
import { Palette, drawRows, makeCanvas } from './pixel';

/**
 * All game art is generated here at boot: 16x16 humanoids with 3 facings x 4 poses,
 * terrain, props, projectiles and HUD icons. Palette swaps turn the ranger into goblins and ogres.
 */

/** Eight-way facing: five drawn views (front, front 3/4, side, back 3/4, back); the left half is mirrored. */
export type Facing = 'down' | 'downside' | 'side' | 'upside' | 'up';
export const FACINGS: Facing[] = ['down', 'downside', 'side', 'upside', 'up'];
/** Frames every unit atlas provides, named `${facing}_${pose}`. Side frames face right; the game mirrors them. */
export const POSES = ['idle', 'walk1', 'walk2', 'attack', 'shoot', 'death'] as const;
export type Pose = (typeof POSES)[number];

/** Unit atlases sliced from art-source/units-sheet.png by tools/slice_sheet.py (2x density, drawn at half size). */
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
        frameRate: 5,
        repeat: -1,
      });
    }
  }
}

const OUTLINE = '#1a1c2c';

// --- Props drawn in code (chest, shadow, projectiles, sparks) ----------------------------------

function buildProps(scene: Phaser.Scene): void {

  // Soft pixel ellipse, 20x6; units scale it to their body radius.
  // Treasure chest, closed and open.
  const chestPal = { k: OUTLINE, w: '#9a5f33', W: '#6b3f22', y: '#e8c170', Y: '#b88a3a', d: '#2a1a10', g: '#ffe27a' };
  const [cc1, cctx1] = makeCanvas(16, 16);
  drawRows(cctx1, [
    '................',
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwWwwwwwwwwWwk.',
    '.kyyyyyyyyyyyyk.',
    '.kYYYYYkkYYYYYk.',
    '.kwwwwkggkwwwwk.',
    '.kwWwwkYYkwwWwk.',
    '.kwWwwwkkwwwWwk.',
    '.kwWwwwwwwwwWwk.',
    '.kyyyyyyyyyyyyk.',
    '.kWWWWWWWWWWWWk.',
    '..kkkkkkkkkkkk..',
    '................',
  ], chestPal);
  scene.textures.addCanvas('chest', cc1);
  const [cc2, cctx2] = makeCanvas(16, 16);
  drawRows(cctx2, [
    '..kkkkkkkkkkkk..',
    '.kwwwwwwwwwwwwk.',
    '.kwWwwwwwwwwWwk.',
    '.kyyyyyyyyyyyyk.',
    '.kddddddddddddk.',
    '.kdddddddddddk..',
    '.kyyyyyyyyyyyyk.',
    '.kYYYYYYYYYYYYk.',
    '.kwwwwwwwwwwwwk.',
    '.kwWwwwwwwwwWwk.',
    '.kwWwwwwwwwwWwk.',
    '.kwWwwwwwwwwWwk.',
    '.kyyyyyyyyyyyyk.',
    '.kWWWWWWWWWWWWk.',
    '..kkkkkkkkkkkk..',
    '................',
  ], chestPal);
  scene.textures.addCanvas('chest_open', cc2);

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
  potion_hp: {
    bg: '#2a1418',
    pal: { k: '#1a1c2c', g: '#c8ccd4', c: '#8a5a35', r: '#d0301a', R: '#ff6a5a', w: '#ffffff' },
    rows: [
      '................',
      '......kkkk......',
      '......kcck......',
      '......kggk......',
      '.....kggggk.....',
      '....kRRrrrrk....',
      '...kRwRrrrrrk...',
      '...kRwrrrrrrk...',
      '...krrrrrrrrk...',
      '...krrrrrrrrk...',
      '...krrrrrrrrk...',
      '....krrrrrrk....',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
  },
  potion_mp: {
    bg: '#141a2e',
    pal: { k: '#1a1c2c', g: '#c8ccd4', c: '#8a5a35', r: '#2a5ad0', R: '#6a9aff', w: '#ffffff' },
    rows: [
      '................',
      '......kkkk......',
      '......kcck......',
      '......kggk......',
      '.....kggggk.....',
      '....kRRrrrrk....',
      '...kRwRrrrrrk...',
      '...kRwrrrrrrk...',
      '...krrrrrrrrk...',
      '...krrrrrrrrk...',
      '...krrrrrrrrk...',
      '....krrrrrrk....',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
  },
  bag: {
    bg: '#2a2014',
    pal: { k: '#1a1c2c', b: '#9a5f33', B: '#6b3f22', y: '#e8c170' },
    rows: [
      '................',
      '......kkkk......',
      '.....kbBBbk.....',
      '......kyyk......',
      '....kkbbbbkk....',
      '...kbbbbbbbbk...',
      '..kbbbbbbbbbbk..',
      '..kbbbyyyybbbk..',
      '..kbbbykkybbbk..',
      '..kbbbyyyybbbk..',
      '..kBbbbbbbbbBk..',
      '..kBBbbbbbbBBk..',
      '...kBBBBBBBBk...',
      '....kkkkkkkk....',
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
  // Atlases authored at 2x get a 2x crop, scaled to the same portrait size.
  const k = frame.width >= 48 ? 2 : 1;
  for (let y = top; y < Math.min(frame.height, top + 8 * k); y++)
    for (let x = 0; x < frame.width; x++) if (opaque(x, y)) [minX, maxX] = [Math.min(minX, x), Math.max(maxX, x)];
  const w = 20 * k;
  const h = 15 * k;
  const sx = Math.round((minX + maxX + 1) / 2 - w / 2);
  const [c, ctx] = makeCanvas(20 * scale, 15 * scale);
  ctx.fillStyle = '#20301f';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(probe, sx, top - k, w, h, 0, 0, c.width, c.height);
  return c.toDataURL();
}

export function buildAllTextures(scene: Phaser.Scene): void {
  registerUnitAnims(scene);
  buildProps(scene);
}
