"""
Slice art-source/sprite-sheet.png (a concept sheet, not a regular grid) into clean
game spritesheets in src/assets/sprites/.

How it works:
  1. Mask out the dark background (and the dark drop-shadows, the game draws its own).
  2. Find connected blobs, slightly dilated so a bow string doesn't split a sprite in two.
  3. Assign each blob to an animation row (by y band) and a direction (nearest column header).
  4. Downscale each sprite by SCALE with area averaging + hard alpha so it becomes real pixel art.
  5. Pack every frame into a fixed-size cell, feet at the bottom centre, and write a PNG + JSON.

Run:  python3 tools/slice_sheet.py   (needs pillow, numpy, scipy)
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'sprite-sheet.png')
OUT = os.path.join(ROOT, 'src', 'assets', 'sprites')
SCALE = 2.6  # source px per game px

# name -> rows (pose, y_min, y_max), column header x positions, cell size in game px
SHEETS = {
    'archer': {
        'rows': [('idle', 65, 130), ('walk', 125, 190), ('attack', 190, 258), ('shoot', 262, 330), ('death', 345, 400)],
        'x': (150, 1295),
        'cell': (32, 28),
        # frame name -> (row, index in row left-to-right, mirror). Side frames all face right.
        'picks': {
            'down_idle': ('idle', 0, False), 'down_walk1': ('walk', 0, False), 'down_walk2': ('walk', 1, False),
            'down_attack': ('attack', 0, False), 'down_shoot': ('shoot', 0, False), 'down_death': ('death', 0, False),
            'side_idle': ('idle', 5, False), 'side_walk1': ('walk', 3, False), 'side_walk2': ('walk', 4, False),
            'side_attack': ('attack', 2, False), 'side_shoot': ('shoot', 5, False), 'side_death': ('death', 3, False),
            'up_idle': ('idle', 4, False), 'up_walk1': ('walk', 7, False), 'up_walk2': ('walk', 7, True),
            'up_attack': ('attack', 7, False), 'up_shoot': ('shoot', 7, False), 'up_death': ('death', 6, False),
        },
    },
    'boar': {
        'rows': [('idle', 455, 510), ('walk', 512, 570), ('attack', 572, 630), ('death', 632, 690)],
        'x': (150, 1295),
        'cell': (40, 24),
        'picks': {
            'down_idle': ('idle', 0, False), 'down_walk1': ('idle', 0, False), 'down_walk2': ('idle', 0, True),
            'down_attack': ('idle', 0, False), 'down_shoot': ('idle', 0, False), 'down_death': ('death', 0, True),
            'side_idle': ('idle', 2, True), 'side_walk1': ('walk', 0, True), 'side_walk2': ('walk', 2, True),
            'side_attack': ('attack', 2, True), 'side_shoot': ('attack', 2, True), 'side_death': ('death', 3, True),
            'up_idle': ('idle', 4, False), 'up_walk1': ('walk', 6, False), 'up_walk2': ('walk', 6, True),
            'up_attack': ('attack', 6, False), 'up_shoot': ('attack', 6, False), 'up_death': ('death', 6, False),
        },
    },
    'skeleton': {
        'rows': [('idle', 738, 800), ('walk', 800, 860), ('attack', 858, 922), ('death', 925, 990)],
        'x': (150, 1295),
        'cell': (44, 28),
        'picks': {
            'down_idle': ('idle', 0, False), 'down_walk1': ('walk', 0, False), 'down_walk2': ('idle', 0, False),
            'down_attack': ('attack', 0, False), 'down_shoot': ('attack', 0, False), 'down_death': ('death', 0, False),
            'side_idle': ('idle', 2, True), 'side_walk1': ('walk', 1, True), 'side_walk2': ('walk', 3, True),
            'side_attack': ('attack', 1, True), 'side_shoot': ('attack', 1, True), 'side_death': ('death', 1, True),
            'up_idle': ('idle', 4, False), 'up_walk1': ('walk', 4, False), 'up_walk2': ('walk', 4, True),
            'up_attack': ('attack', 4, False), 'up_shoot': ('attack', 4, False), 'up_death': ('death', 4, False),
        },
    },
}


def load():
    im = np.array(Image.open(SRC).convert('RGB')).astype(np.float32)
    return im


def background_mask(im):
    """True where the pixel is sprite (not panel background or drop shadow)."""
    # The panels are a dark teal; estimate it per pixel from a heavy blur of the image's darkest tones.
    bg = np.array([30.0, 40.0, 39.0])
    d = np.sqrt(((im - bg) ** 2).sum(axis=2))
    lum = im.mean(axis=2)
    # Shadows are darker than the panel; keep only clearly different, not-darker pixels,
    # plus genuinely dark outline pixels that sit next to bright ones (handled by closing).
    m = (d > 34) & (lum > 30)
    m = ndimage.binary_closing(m, iterations=1)
    m = ndimage.binary_fill_holes(m)
    return m, d


def to_pixel_art(rgb, alpha, scale=SCALE):
    """Area-downscale by SCALE, then make alpha binary and pull colours to the opaque pixels only."""
    h, w = alpha.shape
    nw = max(1, int(round(w / scale)))
    nh = max(1, int(round(h / scale)))
    a = Image.fromarray((alpha * 255).astype(np.uint8))
    a_small = np.array(a.resize((nw, nh), Image.BOX)).astype(np.float32) / 255
    pre = rgb * alpha[..., None]
    pre_img = Image.fromarray(np.clip(pre, 0, 255).astype(np.uint8))
    pre_small = np.array(pre_img.resize((nw, nh), Image.BOX)).astype(np.float32)
    col = pre_small / np.maximum(a_small[..., None], 1e-3)
    on = a_small >= 0.42
    # Slight contrast push so downscaled colours don't look washed out.
    col = np.clip((col - 128) * 1.08 + 128, 0, 255)
    out = np.zeros((nh, nw, 4), np.uint8)
    out[..., :3] = col.astype(np.uint8)
    out[..., 3] = np.where(on, 255, 0)
    # Dark 1px outline where the sprite meets transparency, like hand-made pixel art.
    edge = on & ~ndimage.binary_erosion(on, border_value=0)
    dark = (out[..., :3].astype(np.float32) * 0.55).astype(np.uint8)
    lum = out[..., :3].mean(axis=2)
    outline = edge & (lum > 70)
    out[outline, :3] = dark[outline]
    return out


def blobs_in_row(spec, mask, y0, y1):
    """Sprites in one animation row, left to right (same order as the contact sheet indices)."""
    x0, x1 = spec['x']
    band = np.zeros_like(mask)
    band[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    labels, _ = ndimage.label(ndimage.binary_dilation(band, iterations=3))
    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        if ys.stop - ys.start < 18 or xs.stop - xs.start < 12:
            continue  # stray specks / text
        out.append((ys, xs, labels[sl] == i))
    out.sort(key=lambda t: t[1].start)
    return out


def extract(spec, im, mask, row, index, flip):
    rows = {r[0]: (r[1], r[2]) for r in spec['rows']}
    ys, xs, lab = blobs_in_row(spec, mask, *rows[row])[index]
    px = to_pixel_art(im[ys, xs], (mask[ys, xs] & lab).astype(np.float32), spec.get('scale', SCALE))
    return px[:, ::-1] if flip else px


def anchor_x(px):
    """Horizontal anchor: the centre of the bottom third (the feet), so bows don't shift the body."""
    on = px[..., 3] > 0
    h = on.shape[0]
    cols = np.nonzero(on[int(h * 0.66):].any(axis=0))[0]
    if len(cols) == 0:
        cols = np.nonzero(on.any(axis=0))[0]
    return (cols.min() + cols.max() + 1) / 2


def pack(name, spec, im, mask):
    """Write src/assets/sprites/<name>.png + a Phaser atlas (JSON hash) with frames '<facing>_<pose>'."""
    cw, ch = spec['cell']
    picks = spec['picks']
    cols = 8
    rows = (len(picks) + cols - 1) // cols
    sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    frames = {}
    for k, (fname, (row, index, flip)) in enumerate(picks.items()):
        px = extract(spec, im, mask, row, index, flip)
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


def arrow(im, mask):
    """The east-pointing arrow from the projectile panel."""
    ys, xs = slice(170, 196), slice(1452, 1505)
    alpha = mask[ys, xs].astype(np.float32)
    px = to_pixel_art(im[ys, xs], alpha)
    on = np.nonzero(px[..., 3].any(axis=0))[0], np.nonzero(px[..., 3].any(axis=1))[0]
    px = px[on[1].min():on[1].max() + 1, on[0].min():on[0].max() + 1]
    Image.fromarray(px).save(os.path.join(OUT, 'arrow.png'))
    print('arrow', px.shape[1], 'x', px.shape[0])


# The camp leader: the same boar sliced at a finer scale, so it is bigger without blurry upscaling.
SHEETS['boar_alpha'] = {**SHEETS['boar'], 'scale': 1.85, 'cell': (56, 34)}


def main():
    im = load()
    mask, _ = background_mask(im)
    for name, spec in SHEETS.items():
        pack(name, spec, im, mask)
    arrow(im, mask)


if __name__ == '__main__':
    main()
