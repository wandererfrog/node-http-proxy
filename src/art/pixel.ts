/** Tiny helpers for authoring pixel art in code: rows of characters mapped through a palette. */

export type Palette = Record<string, string>;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Draw a character grid. '.' and ' ' are transparent; unknown chars are ignored. */
export function drawRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  pal: Palette,
  ox = 0,
  oy = 0,
  flipX = false,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (!c) continue;
      px(ctx, ox + (flipX ? row.length - 1 - x : x), oy + y, c);
    }
  }
}

/** Draw a list of [x, y, paletteChar] overlay pixels. */
export function drawPixels(
  ctx: CanvasRenderingContext2D,
  pixels: ReadonlyArray<readonly [number, number, string]>,
  pal: Palette,
  ox = 0,
  oy = 0,
): void {
  for (const [x, y, ch] of pixels) {
    const c = pal[ch];
    if (c) px(ctx, ox + x, oy + y, c);
  }
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amt));
  const g = clamp(((n >> 8) & 255) * (1 + amt));
  const b = clamp((n & 255) * (1 + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
