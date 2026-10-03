import type Phaser from 'phaser';
import { TILE, Tile, WorldMap } from '../world/map';
import { ENV_ATLAS, GRASS_FRAMES, PROPS, footprint } from '../world/props';

/**
 * Bakes the ground into chunk textures from the environment sheet:
 *  - grass, dirt, water: generated in each texture's palette (sampled from the sheet) with
 *    value noise and small marks, so there are no tile seams; dirt and water show through a
 *    noisy mask so roads and ponds get ragged pixel edges; ponds get a muddy bank and a light rim
 *  - paving: the sheet's stone tiles, tiled with random flips (the plaza)
 *  - soft shadows under props, then non-blocking decor (tufts, flowers, pebbles, lily pads)
 *
 * The ground uses the same 2x texel density as the sprites and is drawn at half scale.
 */

export const DENSITY = 2; // texels per world pixel
const T = TILE * DENSITY; // texels per tile
const CHUNK_TILES = 32;

interface Src {
  img: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
}

function frame(scene: Phaser.Scene, name: string): Src {
  const f = scene.textures.getFrame(ENV_ATLAS, name);
  return { img: f.source.image as CanvasImageSource, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
}

function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function noise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, salt) + (hash(x0 + 1, y0, salt) - hash(x0, y0, salt)) * sx;
  const b = hash(x0, y0 + 1, salt) + (hash(x0 + 1, y0 + 1, salt) - hash(x0, y0 + 1, salt)) * sx;
  return a + (b - a) * sy;
}

/** Fill a canvas by tiling a source texture in cells, with a deterministic flip per cell. */
function tileTexture(ctx: CanvasRenderingContext2D, src: Src, cell: number, ox: number, oy: number, salt: number, variants?: Src[], whole = false): void {
  const { width, height } = ctx.canvas;
  const startX = Math.floor(ox / cell);
  const startY = Math.floor(oy / cell);
  for (let cy = startY; cy * cell < oy + height; cy++) {
    for (let cx = startX; cx * cell < ox + width; cx++) {
      const s = variants ? variants[Math.floor(hash(cx, cy, salt) * variants.length)] : src;
      const fx = hash(cx, cy, salt + 1) < 0.5;
      const fy = hash(cx, cy, salt + 2) < 0.5;
      // A random cell-sized window from the source, so repeats don't line up.
      const sw = whole ? s.w : Math.min(cell, s.w);
      const sh = whole ? s.h : Math.min(cell, s.h);
      const sx = whole ? s.x : s.x + Math.floor(hash(cx, cy, salt + 3) * (s.w - sw + 1));
      const sy = whole ? s.y : s.y + Math.floor(hash(cx, cy, salt + 4) * (s.h - sh + 1));
      const dx = cx * cell - ox;
      const dy = cy * cell - oy;
      ctx.save();
      ctx.translate(dx + (fx ? cell : 0), dy + (fy ? cell : 0));
      ctx.scale(fx ? -cell / sw : cell / sw, fy ? -cell / sh : cell / sh);
      ctx.drawImage(s.img, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    }
  }
}

/** The colour tones of some sheet textures, darkest to lightest (luminance percentiles). */
function tones(srcs: Src[], n: number): Array<[number, number, number]> {
  const px: Array<[number, number, number]> = [];
  for (const s of srcs) {
    const [, ctx] = makeCanvas(s.w, s.h);
    ctx.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    const d = ctx.getImageData(0, 0, s.w, s.h).data;
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  }
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return Array.from({ length: n }, (_, i) => px[Math.floor(((i + 0.5) / n) * 0.8 * px.length + 0.1 * px.length)]);
}

type Speck = 'blades' | 'ripples' | 'pebbles';

/**
 * Seamless ground in a texture's own palette: two octaves of value noise pick the tone, plus
 * small marks (grass blades, water ripples, pebbles). No tiling, so no seams or repeats.
 */
function synth(ctx: CanvasRenderingContext2D, ox: number, oy: number, pal: Array<[number, number, number]>, scale: number, salt: number, speck: Speck): void {
  const { width: W, height: H } = ctx.canvas;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const n = pal.length;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = ox + x;
      const gy = oy + y;
      const v = noise(gx / scale, gy / scale, salt) * 0.6 + noise(gx / (scale / 2.7), gy / (scale / 2.7), salt + 1) * 0.28 + hash(gx, gy, salt + 2) * 0.12;
      let t = Math.max(0, Math.min(n - 1, Math.floor((v - 0.12) * n * 1.3)));
      const h = hash(gx, gy, salt + 3);
      if (speck === 'blades') {
        // Short dark blades (2px tall) and the odd light tip.
        if (h < 0.035 || hash(gx, gy + 1, salt + 3) < 0.035) t = 0;
        else if (h > 0.985) t = n - 1;
      } else if (speck === 'ripples') {
        if (hash(Math.floor(gx / 4), gy, salt + 4) < 0.012) t = n - 1;
      } else if (h < 0.02) t = 0;
      const c = pal[t];
      const k = (y * W + x) * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Props standing on the plaza keep paving under them. */
function nearPaved(map: WorldMap, i: number): boolean {
  const x = i % map.width;
  const y = Math.floor(i / map.width);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.get(x + dx, y + dy) === Tile.Paved) return true;
  return false;
}

/** Soft shadows under props (one per solid column group: an arch gets one under each pillar). */
function propShadows(ctx: CanvasRenderingContext2D, map: WorldMap, ox: number, oy: number, W: number, H: number, colour: string): void {
  ctx.fillStyle = colour;
  for (const p of map.props.values()) {
    const def = PROPS[p.key];
    for (const [dx, dy] of footprint(def)) {
      if (dy !== 0) continue;
      const span = def.solid ? 1 : def.w;
      if (!def.solid && dx !== 0) continue;
      const cx = (p.tx + dx + span / 2) * T - ox;
      const cy = (p.ty + 1) * T - 4 - oy;
      const rx = span * T * 0.42;
      if (cx + rx < 0 || cx - rx > W || cy + 8 < 0 || cy - 8 > H) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, T * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Dungeon ground, in the old top-down Zelda style: dark stone floor (the sheet's paving, dimmed
 * and cooled), and walls as a dark mass with a brick face (3/4 view) wherever floor lies below
 * them, a lit ledge on top of that face, stone rims where the wall meets floor at its sides, and
 * shadow cast onto the floor at the foot of every wall.
 */
function buildDungeonGround(scene: Phaser.Scene, map: WorldMap): Array<{ key: string; x: number; y: number }> {
  const stone = [frame(scene, 'ground_plaza'), frame(scene, 'ground_stone')];
  const brickPal = tones([stone[1]], 6).map(([r, g, b]) => [r * 0.5, g * 0.48, b * 0.56] as [number, number, number]);
  const { width, height } = map;
  const wall = (x: number, y: number) => map.get(x, y) === Tile.Wall;
  const FACE = 18; // texels of brick face at the bottom of a wall tile with floor below
  const RIM = 3;
  const out: Array<{ key: string; x: number; y: number }> = [];
  for (let cty = 0; cty < height; cty += CHUNK_TILES) {
    for (let ctx0 = 0; ctx0 < width; ctx0 += CHUNK_TILES) {
      const tw = Math.min(CHUNK_TILES, width - ctx0);
      const th = Math.min(CHUNK_TILES, height - cty);
      const W = tw * T;
      const H = th * T;
      const ox = ctx0 * T;
      const oy = cty * T;
      const [canvas, ctx] = makeCanvas(W, H);
      tileTexture(ctx, stone[0], 32, ox, oy, 53, stone, true);
      const img = ctx.getImageData(0, 0, W, H);
      const px = img.data;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const mx = ctx0 + tx;
          const my = cty + ty;
          const isWall = wall(mx, my);
          const faceBelow = isWall && !wall(mx, my + 1);
          const shadeTop = !isWall && wall(mx, my - 1);
          const shadeL = !isWall && wall(mx - 1, my);
          const shadeR = !isWall && wall(mx + 1, my);
          for (let y = 0; y < T; y++) {
            for (let x = 0; x < T; x++) {
              const gx = ox + tx * T + x;
              const gy = oy + ty * T + y;
              const k = ((ty * T + y) * W + tx * T + x) * 4;
              if (!isWall) {
                // Floor: dimmed, cooled paving, darker in the shadow at the foot of walls.
                let f = 0.6 + noise(gx / 14, gy / 14, 61) * 0.12;
                if (shadeTop) f *= 0.45 + 0.55 * Math.min(1, y / 10);
                if (shadeL) f *= 0.6 + 0.4 * Math.min(1, x / 6);
                if (shadeR) f *= 0.6 + 0.4 * Math.min(1, (T - 1 - x) / 6);
                if (hash(gx >> 1, gy >> 1, 67) < 0.006) f *= 0.55; // cracks and grit
                px[k] = px[k] * f * 0.92;
                px[k + 1] = px[k + 1] * f * 0.9;
                px[k + 2] = px[k + 2] * f * 1.05;
                continue;
              }
              let c: [number, number, number];
              if (faceBelow && y >= T - FACE) {
                // Brick face: courses of 6 texels, bricks 12 wide, every other course offset.
                const fy = y - (T - FACE);
                if (fy < 2) c = [112, 104, 124]; // lit ledge
                else if (fy < 3) c = [20, 17, 24];
                else {
                  const row = Math.floor((fy - 3) / 5);
                  const bx = gx + (row % 2) * 6;
                  const mortar = (fy - 3) % 5 === 4 || bx % 12 === 0;
                  if (mortar) c = [14, 12, 18];
                  else {
                    const tone = brickPal[1 + Math.floor(hash(Math.floor(bx / 12), Math.floor(gy / 5), 71) * 4)];
                    const lit = (fy - 3) % 5 === 0 ? 1.25 : 1; // top edge of each brick catches light
                    c = [tone[0] * lit, tone[1] * lit, tone[2] * lit];
                  }
                  // Darker towards the floor (ambient occlusion).
                  const ao = 1 - Math.max(0, fy - FACE + 6) * 0.07;
                  c = [c[0] * ao, c[1] * ao, c[2] * ao];
                }
              } else {
                // Top of the wall mass: near-black with a little texture, rimmed with stone where floor
                // lies beside or above it.
                const n = noise(gx / 6, gy / 6, 73);
                c = n > 0.62 ? [30, 26, 36] : n < 0.3 ? [16, 14, 20] : [22, 19, 27];
                const rim =
                  (!wall(mx - 1, my) && x < RIM) ||
                  (!wall(mx + 1, my) && x >= T - RIM) ||
                  (!wall(mx, my - 1) && y < RIM) ||
                  (faceBelow && y >= T - FACE - RIM);
                if (rim) c = [74, 68, 84];
              }
              px[k] = c[0];
              px[k + 1] = c[1];
              px[k + 2] = c[2];
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      propShadows(ctx, map, ox, oy, W, H, 'rgba(0, 0, 0, 0.35)');
      const key = `ground_${ctx0}_${cty}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addCanvas(key, canvas);
      out.push({ key, x: ctx0 * TILE, y: cty * TILE });
    }
  }
  return out;
}

/** Builds the chunk textures and returns where to place them (world px, top-left). */
export function buildGround(scene: Phaser.Scene, map: WorldMap): Array<{ key: string; x: number; y: number }> {
  if (map.kind === 'dungeon') return buildDungeonGround(scene, map);
  const grass = GRASS_FRAMES.map((n) => frame(scene, n));
  const dirt = frame(scene, 'ground_dirt');
  const water = frame(scene, 'ground_water');
  const stone = [frame(scene, 'ground_plaza'), frame(scene, 'ground_stone')];
  const grassPal = tones(grass, 6);
  const dirtPal = tones([dirt], 5);
  const waterPal = tones([water], 5);
  const { width, height } = map;
  const isDirt = new Float32Array(width * height);
  const isWater = new Float32Array(width * height);
  const isPaved = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    isPaved[i] = map.tiles[i] === Tile.Paved || (map.tiles[i] === Tile.Block && nearPaved(map, i)) ? 1 : 0;
    isDirt[i] = map.tiles[i] === Tile.Dirt ? 1 : 0;
    isWater[i] = map.tiles[i] === Tile.Water ? 1 : 0;
  }
  const field = (arr: Float32Array, gx: number, gy: number): number => {
    // Bilinear over tile centres.
    const u = gx / T - 0.5;
    const v = gy / T - 0.5;
    const x0 = Math.max(0, Math.min(width - 2, Math.floor(u)));
    const y0 = Math.max(0, Math.min(height - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));
    const i = y0 * width + x0;
    const a = arr[i] + (arr[i + 1] - arr[i]) * fx;
    const b = arr[i + width] + (arr[i + width + 1] - arr[i + width]) * fx;
    return a + (b - a) * fy;
  };

  const out: Array<{ key: string; x: number; y: number }> = [];
  for (let cty = 0; cty < height; cty += CHUNK_TILES) {
    for (let ctx0 = 0; ctx0 < width; ctx0 += CHUNK_TILES) {
      const tw = Math.min(CHUNK_TILES, width - ctx0);
      const th = Math.min(CHUNK_TILES, height - cty);
      const W = tw * T;
      const H = th * T;
      const ox = ctx0 * T;
      const oy = cty * T;
      const [canvas, ctx] = makeCanvas(W, H);
      synth(ctx, ox, oy, grassPal, 9, 11, 'blades');

      // Dirt and water through noisy masks, only where a tile nearby needs it.
      const [, dctx] = makeCanvas(W, H);
      synth(dctx, ox, oy, dirtPal, 6, 23, 'pebbles');
      const [, wctx] = makeCanvas(W, H);
      synth(wctx, ox, oy, waterPal, 12, 37, 'ripples');
      const [, sctx] = makeCanvas(W, H);
      // Paving: whole stone tiles (not random windows) so the slab pattern lines up.
      tileTexture(sctx, stone[0], 32, ox, oy, 41, stone, true);
      const spx = sctx.getImageData(0, 0, W, H).data;
      const base = ctx.getImageData(0, 0, W, H);
      const dpx = dctx.getImageData(0, 0, W, H).data;
      const wpx = wctx.getImageData(0, 0, W, H).data;
      const px = base.data;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const mx = ctx0 + tx;
          const my = cty + ty;
          let nearDirt = false;
          let nearWater = false;
          let nearStone = false;
          for (let oy2 = -1; oy2 <= 1; oy2++)
            for (let ox2 = -1; ox2 <= 1; ox2++) {
              const t = map.get(mx + ox2, my + oy2);
              if (t === Tile.Dirt) nearDirt = true;
              if (t === Tile.Water) nearWater = true;
              if (isPaved[(my + oy2) * width + mx + ox2]) nearStone = true;
            }
          if (!nearDirt && !nearWater && !nearStone) continue;
          for (let y = ty * T; y < (ty + 1) * T; y++) {
            for (let x = tx * T; x < (tx + 1) * T; x++) {
              const gx = ox + x;
              const gy = oy + y;
              const n = noise(gx / 5, gy / 5, 3) * 0.6 + noise(gx / 2, gy / 2, 5) * 0.4 - 0.5;
              const k = (y * W + x) * 4;
              if (nearWater) {
                const f = field(isWater, gx, gy) + n * 0.45;
                if (f > 0.5) {
                  const rim = f < 0.56;
                  px[k] = rim ? 143 : wpx[k];
                  px[k + 1] = rim ? 196 : wpx[k + 1];
                  px[k + 2] = rim ? 240 : wpx[k + 2];
                  continue;
                }
                if (f > 0.38) {
                  // Muddy bank, darker right at the water.
                  const dark = f > 0.47;
                  px[k] = dark ? 92 : 128;
                  px[k + 1] = dark ? 62 : 88;
                  px[k + 2] = dark ? 36 : 52;
                  continue;
                }
              }
              if (nearStone) {
                const f = field(isPaved, gx, gy) + n * 0.35;
                if (f > 0.5) {
                  px[k] = spx[k];
                  px[k + 1] = spx[k + 1];
                  px[k + 2] = spx[k + 2];
                  continue;
                }
              }
              if (nearDirt) {
                const f = field(isDirt, gx, gy) + n * 0.5;
                if (f > 0.5) {
                  px[k] = dpx[k];
                  px[k + 1] = dpx[k + 1];
                  px[k + 2] = dpx[k + 2];
                } else if (f > 0.44) {
                  // Darker grass lip along road edges.
                  px[k] = px[k] * 0.78;
                  px[k + 1] = px[k + 1] * 0.82;
                  px[k + 2] = px[k + 2] * 0.78;
                }
              }
            }
          }
        }
      }
      ctx.putImageData(base, 0, 0);

      // Shadows under props.
      propShadows(ctx, map, ox, oy, W, H, 'rgba(16, 32, 12, 0.28)');
      // Decor, anchored bottom-centre.
      for (const d of map.decor) {
        const f = frame(scene, d.key);
        const dx = Math.round(d.x * DENSITY - f.w / 2) - ox;
        const dy = Math.round(d.y * DENSITY - f.h) - oy;
        if (dx + f.w < 0 || dx > W || dy + f.h < 0 || dy > H) continue;
        ctx.drawImage(f.img, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
      }

      const key = `ground_${ctx0}_${cty}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addCanvas(key, canvas);
      out.push({ key, x: ctx0 * TILE, y: cty * TILE });
    }
  }
  return out;
}
