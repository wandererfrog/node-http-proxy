"""
Slice art-source/units-sheet.png into game-ready atlases in src/assets/sprites/.

The sheet has three panels (archer, boar, skeleton) on a baked-in grey/white checkerboard.
  1. Background = near-neutral light pixels (the checkerboard, panel borders and grey drop shadows).
     Everything else is sprite; small enclosed holes (blade highlights, arrow fletching) are filled back in.
  2. Sprites are connected blobs; blobs are grouped into rows by y and sorted by x, giving (row, col).
  3. `picks` maps each game frame to a (row, col, mirror) on the sheet. The sheet's columns aren't
     perfectly consistent, so the picks were chosen by eye (see the contact sheet from --contact).
  4. Each sprite is area-downscaled by SCALE into crisp pixel art (hard alpha) and packed into fixed
     cells, feet at the bottom centre, with a Phaser atlas (JSON hash) next to the PNG.

Game frames are named `<facing>_<pose>`:
  facings: down, downside (front 3/4), side, upside (back 3/4), up. Side views face right;
           the game mirrors them for the left half of the compass.
  poses:   idle, walk1, walk2, attack, shoot, death

The arrow projectile is still cut from the older concept sheet, art-source/sprite-sheet.png.

Run:  python3 tools/slice_sheet.py [--contact OUT_DIR]   (needs pillow, numpy, scipy)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'units-sheet.png')
ARROW_SRC = os.path.join(ROOT, 'art-source', 'sprite-sheet.png')
OUT = os.path.join(ROOT, 'src', 'assets', 'sprites')

# Sprites are sliced at 2x the world's pixel density and drawn at half size in game.
SCALE = 2.2


def P(row, col, flip=False):
    return (row, col, flip)


def eight_way(rows, cols, flips=()):
    """Picks for one pose: cols maps facing -> column; facings listed in `flips` are mirrored."""
    return {f: P(rows, c, f in flips) for f, c in cols.items()}


SHEETS = {
    'archer': {
        'panel': (0, 0, 800, 500),
        'cell': (56, 52),
        # rows: 0 idle, 1 walk, 2 shoot, 3 death
        'picks': {
            'idle': eight_way(0, {'down': 0, 'downside': 7, 'side': 6, 'upside': 5, 'up': 4}),
            'walk1': eight_way(1, {'down': 0, 'downside': 7, 'side': 6, 'upside': 5, 'up': 4}),
            'walk2': eight_way(0, {'down': 0, 'downside': 7, 'side': 6, 'upside': 5, 'up': 4}),
            # Columns 3, 6 and 7 of the shoot row aim left (arrowhead on the left), so the right-facing
            # release is column 7 mirrored.
            'attack': eight_way(2, {'down': 0, 'downside': 1, 'side': 2, 'upside': 5, 'up': 4}),
            'shoot': eight_way(2, {'down': 0, 'downside': 1, 'side': 7, 'upside': 5, 'up': 4}, flips=('side',)),
            'death': eight_way(3, {'down': 6, 'downside': 7, 'side': 2, 'upside': 3, 'up': 4}, flips=('side', 'upside')),
        },
    },
    'boar': {
        'panel': (800, 0, 1536, 420),
        'cell': (48, 44),
        # rows: 0 idle, 1 walk, 2 attack, 3 death. No back-3/4 view, so upside reuses the side view.
        'picks': {
            'idle': eight_way(0, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
            'walk1': eight_way(1, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
            'walk2': eight_way(0, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
            'attack': eight_way(2, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
            'shoot': eight_way(2, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
            'death': eight_way(3, {'down': 0, 'downside': 1, 'side': 2, 'upside': 2, 'up': 3}),
        },
    },
    'skeleton': {
        'panel': (280, 500, 1260, 1024),
        'cell': (60, 50),
        # rows: 0 idle, 1 walk, 2 thrust, 3 swing, 4 death
        'picks': {
            'idle': eight_way(0, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}),
            'walk1': eight_way(1, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}),
            'walk2': eight_way(0, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}),
            'attack': eight_way(3, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}),
            'shoot': eight_way(2, {'down': 0, 'downside': 8, 'side': 7, 'upside': 5, 'up': 4}),
            'death': eight_way(4, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}),
        },
    },
}
# The camp leader: the boar again, sliced finer so it is bigger without blurry upscaling.
SHEETS['boar_alpha'] = {**SHEETS['boar'], 'scale': 1.6, 'cell': (64, 60)}


def load():
    rgba = np.array(Image.open(SRC).convert('RGBA')).astype(np.float32)
    rgb = rgba[..., :3]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    # Sprite = clearly coloured or dark (outlines). Light neutral pixels are checkerboard or shadow.
    sprite = ((sat > 32) | (lum < 150)) & (rgba[..., 3] >= 128)
    # Fill small enclosed holes (shiny blade pixels, fletching); big enclosed areas stay background.
    holes = ndimage.binary_fill_holes(sprite) & ~sprite
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, range(1, n + 1))
        small = np.isin(lab, np.nonzero(sizes < 120)[0] + 1)
        sprite |= small
    return rgb, sprite


def grid(spec, mask):
    """{(row, col): (ys, xs, blob mask)} for the sprites inside a panel."""
    x0, y0, x1, y1 = spec['panel']
    sub = np.zeros_like(mask)
    sub[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    labels, _ = ndimage.label(sub)
    blobs = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None or sl[0].stop - sl[0].start <= 25 or sl[1].stop - sl[1].start <= 15:
            continue
        blobs.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, sl, i))
    blobs.sort()
    rows, cur = [], [blobs[0]]
    for b in blobs[1:]:
        if b[0] - cur[-1][0] > 25:
            rows.append(cur)
            cur = [b]
        else:
            cur.append(b)
    rows.append(cur)
    out = {}
    for r, row in enumerate(rows):
        for c, (_, _, sl, i) in enumerate(sorted(row, key=lambda b: b[1])):
            out[(r, c)] = (sl[0], sl[1], labels[sl] == i)
    return out


def to_pixel_art(rgb, alpha, scale):
    """Area-downscale with premultiplied colour, then a hard alpha cut so edges stay crisp."""
    h, w = alpha.shape
    nw = max(1, int(round(w / scale)))
    nh = max(1, int(round(h / scale)))
    a_small = np.array(Image.fromarray((alpha * 255).astype(np.uint8)).resize((nw, nh), Image.BOX)).astype(np.float32) / 255
    pre = Image.fromarray(np.clip(rgb * alpha[..., None], 0, 255).astype(np.uint8))
    pre_small = np.array(pre.resize((nw, nh), Image.BOX)).astype(np.float32)
    col = pre_small / np.maximum(a_small[..., None], 1e-3)
    out = np.zeros((nh, nw, 4), np.uint8)
    out[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(a_small >= 0.45, 255, 0)
    return out


def anchor_x(px):
    """Horizontal anchor: centre of the bottom third (the feet), so bows and swords don't shift the body."""
    on = px[..., 3] > 0
    cols = np.nonzero(on[int(on.shape[0] * 0.66):].any(axis=0))[0]
    if len(cols) == 0:
        cols = np.nonzero(on.any(axis=0))[0]
    return (cols.min() + cols.max() + 1) / 2


def pack(name, spec, rgb, mask):
    cw, ch = spec['cell']
    cells = grid(spec, mask)
    frames_list = [(f'{facing}_{pose}', pick) for pose, by_facing in spec['picks'].items() for facing, pick in by_facing.items()]
    cols = 10
    rows = (len(frames_list) + cols - 1) // cols
    sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    frames = {}
    for k, (fname, (r, c, flip)) in enumerate(frames_list):
        ys, xs, lab = cells[(r, c)]
        px = to_pixel_art(rgb[ys, xs], (mask[ys, xs] & lab).astype(np.float32), spec.get('scale', SCALE))
        if flip:
            px = px[:, ::-1]
        h, w = px.shape[:2]
        if w > cw or h > ch:
            print(f'  !! {name} {fname} is {w}x{h}, larger than the {cw}x{ch} cell', file=sys.stderr)
        ox = int(round(cw / 2 - anchor_x(px)))
        oy = ch - h - 1
        cx, cy = (k % cols) * cw, (k // cols) * ch
        for yy in range(h):
            for xx in range(w):
                tx, ty = ox + xx, oy + yy
                if 0 <= tx < cw and 0 <= ty < ch and px[yy, xx, 3]:
                    sheet[cy + ty, cx + tx] = px[yy, xx]
        frames[fname] = {
            'frame': {'x': cx, 'y': cy, 'w': cw, 'h': ch},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': cw, 'h': ch},
            'sourceSize': {'w': cw, 'h': ch},
        }
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(sheet).save(os.path.join(OUT, f'{name}.png'))
    atlas = {'frames': frames, 'meta': {'image': f'{name}.png', 'size': {'w': sheet.shape[1], 'h': sheet.shape[0]}, 'scale': '1'}}
    with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
        json.dump(atlas, f, indent=1)
    print(name, len(frames), 'frames')


def contact(out_dir, rgb, mask):
    """Labelled contact sheets (r<row> c<col>) to choose picks from."""
    for name, spec in SHEETS.items():
        cells = grid(spec, mask)
        nr = max(r for r, _ in cells) + 1
        nc = max(c for _, c in cells) + 1
        W, H = 110, 120
        img = Image.new('RGB', (nc * W, nr * H), (70, 120, 60))
        d = ImageDraw.Draw(img)
        for (r, c), (ys, xs, lab) in cells.items():
            crop = np.zeros((ys.stop - ys.start, xs.stop - xs.start, 4), np.uint8)
            crop[..., :3] = rgb[ys, xs].astype(np.uint8)
            crop[..., 3] = np.where(mask[ys, xs] & lab, 255, 0)
            img.paste(Image.fromarray(crop, 'RGBA'), (c * W + 5, r * H + 16), Image.fromarray(crop, 'RGBA'))
            d.text((c * W + 3, r * H + 2), f'r{r} c{c}', fill=(255, 255, 0))
        img.save(os.path.join(out_dir, f'contact_{name}.png'))


def arrow():
    """The east-pointing arrow from the projectile panel of the older concept sheet."""
    im = np.array(Image.open(ARROW_SRC).convert('RGB')).astype(np.float32)
    ys, xs = slice(170, 196), slice(1452, 1505)
    d = np.sqrt(((im[ys, xs] - np.array([30.0, 40.0, 39.0])) ** 2).sum(axis=2))
    alpha = ((d > 34) & (im[ys, xs].mean(axis=2) > 30)).astype(np.float32)
    px = to_pixel_art(im[ys, xs], alpha, 2.6)
    on = np.nonzero(px[..., 3])
    px = px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]
    Image.fromarray(px).save(os.path.join(OUT, 'arrow.png'))
    print('arrow', px.shape[1], 'x', px.shape[0])


def main():
    rgb, mask = load()
    if '--contact' in sys.argv:
        contact(sys.argv[sys.argv.index('--contact') + 1], rgb, mask)
        return
    for name, spec in SHEETS.items():
        pack(name, spec, rgb, mask)
    arrow()


if __name__ == '__main__':
    main()
