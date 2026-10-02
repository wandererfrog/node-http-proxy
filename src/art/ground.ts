import type Phaser from 'phaser';
import { TILE, Tile, WorldMap } from '../world/map';
import { GRASS_FRAMES, PROPS } from '../world/props';

/**
 * Bakes the ground into chunk textures from the environment sheet:
 *  - grass: crops of the sheet's grass squares in a jittered grid (variant + flips per cell)
 *  - dirt / water: tiled sheet textures, revealed through a noisy mask so roads and ponds get
 *    ragged pixel edges like the hand-drawn tiles; ponds get a muddy bank and a light rim
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
  const f = scene.textures.getFrame('env', name);
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
function tileTexture(ctx: CanvasRenderingContext2D, src: Src, cell: number, ox: number, oy: number, salt: number, variants?: Src[]): void {
  const { width, height } = ctx.canvas;
  const startX = Math.floor(ox / cell);
  const startY = Math.floor(oy / cell);
  for (let cy = startY; cy * cell < oy + height; cy++) {
    for (let cx = startX; cx * cell < ox + width; cx++) {
      const s = variants ? variants[Math.floor(hash(cx, cy, salt) * variants.length)] : src;
      const fx = hash(cx, cy, salt + 1) < 0.5;
      const fy = hash(cx, cy, salt + 2) < 0.5;
      // A random cell-sized window from the source, so repeats don't line up.
      const sw = Math.min(cell, s.w);
      const sh = Math.min(cell, s.h);
      const sx = s.x + Math.floor(hash(cx, cy, salt + 3) * (s.w - sw + 1));
      const sy = s.y + Math.floor(hash(cx, cy, salt + 4) * (s.h - sh + 1));
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

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Builds the chunk textures and returns where to place them (world px, top-left). */
export function buildGround(scene: Phaser.Scene, map: WorldMap): Array<{ key: string; x: number; y: number }> {
  const grass = GRASS_FRAMES.map((n) => frame(scene, n));
  const dirt = frame(scene, 'ground_dirt');
  const water = frame(scene, 'ground_water');
  const { width, height } = map;
  const isDirt = new Float32Array(width * height);
  const isWater = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
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
      tileTexture(ctx, grass[0], 40, ox, oy, 11, grass);

      // Dirt and water through noisy masks, only where a tile nearby needs it.
      const [, dctx] = makeCanvas(W, H);
      tileTexture(dctx, dirt, 36, ox, oy, 23);
      const [, wctx] = makeCanvas(W, H);
      tileTexture(wctx, water, 26, ox, oy, 37);
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
          for (let oy2 = -1; oy2 <= 1; oy2++)
            for (let ox2 = -1; ox2 <= 1; ox2++) {
              const t = map.get(mx + ox2, my + oy2);
              if (t === Tile.Dirt) nearDirt = true;
              if (t === Tile.Water) nearWater = true;
            }
          if (!nearDirt && !nearWater) continue;
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
      ctx.fillStyle = 'rgba(16, 32, 12, 0.28)';
      for (const p of map.props.values()) {
        const def = PROPS[p.key];
        const cx = (p.tx + def.w / 2) * T - ox;
        const cy = (p.ty + 1) * T - 4 - oy;
        const rx = def.w * T * 0.42;
        if (cx + rx < 0 || cx - rx > W || cy + 8 < 0 || cy - 8 > H) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, T * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
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
