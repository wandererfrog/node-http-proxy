/**
 * Pixel-art UI chrome for the DOM panels, drawn once at boot into data URLs and used as CSS
 * `border-image`s and background tiles. Everything is drawn at its final CSS size (each art pixel is
 * PX css pixels) so the browser never rescales it and the edges stay hard.
 *
 * Style: Warcraft-like gold and bronze bevels, inset stone slots, the dark blue tooltip, all in
 * chunky pixels to match the game's art.
 */

const PX = 2;

type Rgb = string;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w * PX;
  c.height = h * PX;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, c: Rgb): void {
  ctx.fillStyle = c;
  ctx.fillRect(x * PX, y * PX, PX, PX);
}

/**
 * A square 9-slice frame of `size` art pixels whose rings (outside in) take the colours in `rings`:
 * each ring is [top-left colour, bottom-right colour] for the bevel, or null for transparent.
 */
function bevel(size: number, rings: Array<[Rgb, Rgb] | null>, fill: Rgb | null): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (d >= rings.length) {
        if (fill) dot(ctx, x, y, fill);
        continue;
      }
      const ring = rings[d];
      if (!ring) continue;
      // Top and left edges catch the light; bottom and right are in shade.
      const lit = Math.min(x, y) === d && !(x === size - 1 - d || y === size - 1 - d);
      dot(ctx, x, y, lit ? ring[0] : ring[1]);
    }
  return c;
}

const OUTLINE = '#0b0906';

/** The main panel frame: black outline, bronze, a bright gold bevel, bronze, black, with gold rivets on the corners. */
function panelFrame(): HTMLCanvasElement {
  const size = 20;
  const c = bevel(
    size,
    [
      [OUTLINE, OUTLINE],
      ['#7a5426', '#4a3014'],
      ['#f2d488', '#9a6a26'],
      ['#c8963e', '#6a4818'],
      ['#4a3014', '#2a1a0a'],
      [OUTLINE, OUTLINE],
    ],
    null,
  );
  const ctx = c.getContext('2d')!;
  // Corner rivets: a little gold stud with a highlight, sitting on each corner of the frame.
  const rivet = (cx: number, cy: number) => {
    const rows = ['.kkkk.', 'kYyyok', 'kyyyok', 'kyyook', 'kooook', '.kkkk.'];
    const pal: Record<string, Rgb> = { k: OUTLINE, Y: '#fff2b0', y: '#f2c850', o: '#a87420' };
    rows.forEach((r, y) => [...r].forEach((ch, x) => pal[ch] && dot(ctx, cx + x, cy + y, pal[ch])));
  };
  rivet(0, 0);
  rivet(size - 6, 0);
  rivet(0, size - 6);
  rivet(size - 6, size - 6);
  return c;
}

/** An inset section (stats, equipment, bag): dark well with a shaded rim. */
function insetFrame(): HTMLCanvasElement {
  return bevel(
    8,
    [
      [OUTLINE, OUTLINE],
      ['#2a2418', '#6a5434'],
      ['#151210', '#2a2418'],
    ],
    'rgba(10, 9, 7, 0.55)',
  );
}

/** One item slot: a sunken stone square. */
function slotFrame(): HTMLCanvasElement {
  return bevel(
    8,
    [
      [OUTLINE, OUTLINE],
      ['#3a3226', '#7a6a4c'],
      ['#0e0d0b', '#2e2a22'],
    ],
    '#16140f',
  );
}

/** The item tooltip: WoW's dark blue with a grey rim. (10 px: 4 rings each side plus a 2 px middle to stretch.) */
function tooltipFrame(): HTMLCanvasElement {
  return bevel(
    10,
    [
      [OUTLINE, OUTLINE],
      ['#b8b8c8', '#7a7a8a'],
      ['#3a3a4a', '#2a2a36'],
      [OUTLINE, OUTLINE],
    ],
    'rgba(8, 12, 30, 0.96)',
  );
}

/** A pixel button (menu, close): raised bevel in the given colours. */
function buttonFrame(light: Rgb, mid: Rgb, dark: Rgb): HTMLCanvasElement {
  return bevel(
    8,
    [
      [OUTLINE, OUTLINE],
      [light, dark],
      [mid, dark],
    ],
    mid,
  );
}

/** Dark leather/stone texture for panel backgrounds: a dithered tile. */
function backgroundTile(): HTMLCanvasElement {
  const n = 24;
  const [c, ctx] = canvas(n, n);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = rand();
      dot(ctx, x, y, r < 0.12 ? '#221e18' : r < 0.2 ? '#131110' : r < 0.23 ? '#2a251d' : '#1a1814');
    }
  return c;
}

export interface UiArt {
  panel: string;
  inset: string;
  slot: string;
  tooltip: string;
  buttonGold: string;
  buttonRed: string;
  background: string;
  /** css px per art pixel, for the border-image slices. */
  px: number;
}

let cached: UiArt | null = null;

export function uiArt(): UiArt {
  if (cached) return cached;
  cached = {
    panel: panelFrame().toDataURL(),
    inset: insetFrame().toDataURL(),
    slot: slotFrame().toDataURL(),
    tooltip: tooltipFrame().toDataURL(),
    buttonGold: buttonFrame('#f2d488', '#3a2c16', '#1a1208').toDataURL(),
    buttonRed: buttonFrame('#ff8a6a', '#8a1a12', '#3a0806').toDataURL(),
    background: backgroundTile().toDataURL(),
    px: PX,
  };
  return cached;
}

/** Expose the art to CSS as custom properties on `el`. */
export function applyUiArt(el: HTMLElement): void {
  const a = uiArt();
  for (const [k, v] of Object.entries(a)) if (typeof v === 'string') el.style.setProperty(`--ui-${k}`, `url(${v})`);
}
