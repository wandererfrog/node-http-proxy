"""
Slice art-source/units-sheet.png and art-source/environment-sheet.png into game-ready atlases
in src/assets/sprites/.

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


# --- Environment sheet ------------------------------------------------------------------------
ENV_SRC = os.path.join(ROOT, 'art-source', 'environment-sheet.png')

# Props: name -> (x0, y0, x1, y1) box on the sheet. Every sprite pixel inside the box is kept.
ENV_PROPS = {
    'oak_big_0': (22, 18, 178, 192), 'oak_big_1': (180, 18, 318, 192), 'oak_big_2': (324, 18, 462, 192),
    'oak_big_3': (468, 18, 616, 192),
    'pine_0': (622, 26, 724, 188), 'pine_1': (730, 22, 842, 188), 'pine_2': (848, 26, 946, 188),
    'pine_3': (952, 26, 1034, 144), 'pine_4': (1050, 34, 1122, 140),
    'dead_0': (1140, 20, 1218, 142), 'dead_1': (1236, 20, 1314, 142), 'dead_2': (1320, 56, 1376, 138),
    'log_0': (1384, 80, 1506, 134), 'log_1': (1258, 812, 1394, 894),
    'pine_small_0': (968, 150, 1018, 202), 'pine_small_1': (1034, 150, 1086, 202),
    'stump_0': (1102, 162, 1154, 200), 'stump_1': (1170, 154, 1228, 202), 'stump_2': (1402, 162, 1446, 200),
    'stump_3': (1466, 154, 1506, 202), 'stump_big': (1406, 818, 1512, 898),
    'oak_small_0': (24, 196, 116, 312), 'oak_small_1': (130, 192, 224, 312), 'oak_small_2': (238, 200, 316, 304),
    'oak_small_3': (330, 208, 398, 296), 'oak_small_4': (412, 198, 498, 310),
    **{f'bush_{i}': (512 + 92 * (i % 5) - (i % 5 > 1) * 0, 198 if i < 5 else 262, 588 + 92 * (i % 5), 256 if i < 5 else 324) for i in range(10)},
    'tuft_0': (966, 214, 1022, 262), 'tuft_1': (1038, 214, 1094, 262), 'tuft_2': (1110, 214, 1168, 262),
    'tuft_3': (966, 270, 1022, 316), 'tuft_4': (1038, 270, 1094, 318), 'tuft_5': (1104, 270, 1150, 316),
    'tuft_6': (1168, 270, 1236, 320), 'tuft_7': (1468, 264, 1514, 310),
    'reeds_0': (1188, 214, 1250, 266), 'reeds_1': (1264, 218, 1326, 266), 'reeds_2': (1340, 218, 1394, 266),
    'flower_0': (1246, 282, 1284, 318), 'flower_1': (1298, 282, 1336, 320), 'flower_2': (1348, 282, 1380, 320),
    'flower_3': (1390, 282, 1422, 320), 'flower_4': (1434, 288, 1462, 320),
    'boulder_0': (22, 324, 152, 466), 'boulder_1': (160, 336, 274, 438), 'boulder_2': (290, 326, 404, 438),
    'rock_0': (422, 338, 520, 422), 'rock_1': (540, 352, 618, 412), 'rock_2': (640, 358, 716, 412),
    'rock_3': (734, 346, 826, 422),
    'pebble_0': (30, 462, 66, 490), 'pebble_1': (146, 444, 200, 490), 'pebble_2': (230, 444, 292, 490),
    'pebble_3': (318, 444, 384, 490), 'pebble_4': (708, 440, 766, 482), 'pebble_5': (784, 448, 818, 478),
    'lily_0': (1370, 342, 1418, 388), 'lily_1': (1336, 400, 1374, 442), 'lily_2': (1386, 400, 1418, 442),
    'signpost': (22, 794, 86, 898), 'fence_0': (104, 808, 216, 866), 'fence_1': (234, 812, 326, 868),
    'lamppost': (382, 794, 440, 900), 'crate': (470, 808, 532, 876), 'barrel': (552, 804, 614, 878),
    'cart': (630, 796, 732, 880), 'sack': (752, 816, 800, 876), 'firewood': (818, 820, 894, 886),
    'tomb': (24, 914, 86, 994), 'pillar_0': (112, 880, 178, 998), 'wall_0': (190, 904, 282, 980),
    'wall_1': (300, 892, 390, 1000), 'pillar_1': (416, 906, 474, 992), 'wall_2': (488, 892, 586, 1000),
    'arch': (610, 888, 732, 1000), 'pillar_2': (752, 916, 818, 994), 'wall_3': (836, 932, 916, 992),
    'clover_0': (950, 862, 1040, 898), 'clover_1': (1068, 862, 1128, 902), 'leaves': (1160, 858, 1232, 906),
    'twigs': (944, 920, 1030, 948), 'branch': (1246, 164, 1322, 196),
    'mushroom_0': (1058, 914, 1094, 952), 'mushroom_1': (1096, 930, 1120, 952), 'mushroom_2': (1124, 920, 1156, 952),
}
# Ground textures: plain crops (no masking), tiled by the game.
ENV_GROUND = {
    'ground_grass_0': (24, 520, 122, 618), 'ground_grass_1': (150, 520, 268, 618), 'ground_grass_2': (296, 520, 392, 648),
    'ground_grass_3': (24, 646, 122, 772), 'ground_grass_4': (296, 676, 392, 772), 'ground_grass_5': (1052, 516, 1124, 592),
    'ground_grass_6': (1146, 516, 1220, 592), 'ground_grass_7': (1146, 610, 1220, 686),
    'ground_dirt': (1412, 566, 1518, 606), 'ground_water': (1085, 380, 1140, 440),
}


def slice_env():
    rgba = np.array(Image.open(ENV_SRC).convert('RGBA')).astype(np.float32)
    rgb = rgba[..., :3]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    sprite = ((sat > 32) | (lum < 150)) & (rgba[..., 3] >= 128)
    holes = ndimage.binary_fill_holes(sprite) & ~sprite
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, range(1, n + 1))
        sprite |= np.isin(lab, np.nonzero(sizes < 120)[0] + 1)
    images = {}
    for name, (x0, y0, x1, y1) in ENV_PROPS.items():
        m = sprite[y0:y1, x0:x1]
        # Drop specks that aren't part of the prop (stray neighbours at the box edge).
        lab, n = ndimage.label(m)
        if n > 1:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            m = np.isin(lab, np.nonzero(sizes >= max(12, sizes.max() * 0.04))[0] + 1)
        px = to_pixel_art(rgb[y0:y1, x0:x1], m.astype(np.float32), SCALE)
        on = np.nonzero(px[..., 3])
        images[name] = px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]
    for name, (x0, y0, x1, y1) in ENV_GROUND.items():
        crop = Image.fromarray(rgb[y0:y1, x0:x1].astype(np.uint8))
        crop = crop.resize((round((x1 - x0) / SCALE), round((y1 - y0) / SCALE)), Image.BOX)
        arr = np.zeros((crop.height, crop.width, 4), np.uint8)
        arr[..., :3] = np.array(crop)
        arr[..., 3] = 255
        images[name] = arr
    # Shelf-pack into one atlas, tallest first, 1px gutters.
    W = 1024
    order = sorted(images, key=lambda k: -images[k].shape[0])
    x = y = shelf = 0
    pos = {}
    for k in order:
        h, w = images[k].shape[:2]
        if x + w > W:
            x, y, shelf = 0, y + shelf + 1, 0
        pos[k] = (x, y)
        x += w + 1
        shelf = max(shelf, h)
    H = y + shelf
    sheet = np.zeros((H, W, 4), np.uint8)
    frames = {}
    for k, (fx, fy) in pos.items():
        h, w = images[k].shape[:2]
        sheet[fy: fy + h, fx: fx + w] = images[k]
        frames[k] = {
            'frame': {'x': fx, 'y': fy, 'w': w, 'h': h}, 'rotated': False, 'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'sourceSize': {'w': w, 'h': h},
        }
    Image.fromarray(sheet).save(os.path.join(OUT, 'env.png'))
    with open(os.path.join(OUT, 'env.json'), 'w') as f:
        json.dump({'frames': frames, 'meta': {'image': 'env.png', 'size': {'w': W, 'h': H}, 'scale': '1'}}, f, indent=1)
    print('env', len(frames), 'frames', f'{W}x{H}')


def main():
    rgb, mask = load()
    if '--contact' in sys.argv:
        contact(sys.argv[sys.argv.index('--contact') + 1], rgb, mask)
        return
    for name, spec in SHEETS.items():
        pack(name, spec, rgb, mask)
    arrow()
    slice_env()


if __name__ == '__main__':
    main()
