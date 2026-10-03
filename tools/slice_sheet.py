"""
Slice art-source/units-sheet.png and art-source/elven-sheet.png into game-ready atlases
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
        # rows: 0 idle, 1 walk, 2 thrust, 3 swing, 4 death. The idle/walk side and front-diagonal
        # frames face left on the sheet (shield forward), the attack rows face right.
        'auto_facing': False,
        'picks': {
            'idle': eight_way(0, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}, flips=('downside', 'side')),
            'walk1': eight_way(1, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}, flips=('downside', 'side')),
            'walk2': eight_way(0, {'down': 0, 'downside': 8, 'side': 6, 'upside': 5, 'up': 4}, flips=('downside', 'side')),
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


def facing_sign(unit, px):
    """
    Which way a frame faces horizontally: +1 right, -1 left, 0 unsure. Uses a per-unit 'front'
    marker (the archer's skin, the skeleton's eye sockets, the boar's tusks) against the body centre.
    The sheet's columns are not reliable about this, so every side/diagonal frame is checked.
    """
    on = px[..., 3] > 0
    ys, xs = np.nonzero(on)
    if len(xs) == 0:
        return 0
    body_cx = xs.mean()
    rgb = px[..., :3].astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = rgb.mean(axis=2)
    if unit == 'archer':
        marker = on & (r > 185) & (g > 130) & (g < 215) & (b > 90) & (b < 185) & (r > g) & (g > b)
    elif unit == 'skeleton':
        top = ys.min()
        head = np.zeros_like(on)
        head[top: top + int(on.shape[0] * 0.32)] = True
        interior = ndimage.binary_erosion(on, iterations=1)
        marker = head & interior & (lum < 90)
        hy, hx = np.nonzero(head & on)
        body_cx = hx.mean() if len(hx) else body_cx
    else:  # boar: tusks
        sat = rgb.max(axis=2) - rgb.min(axis=2)
        marker = on & (lum > 200) & (sat < 30)
    my, mx = np.nonzero(marker)
    if len(mx) < 3:
        return 0
    d = mx.mean() - body_cx
    return 1 if d > 1.2 else -1 if d < -1.2 else 0


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
    unit = 'boar' if name.startswith('boar') else name
    for k, (fname, (r, c, flip)) in enumerate(frames_list):
        ys, xs, lab = cells[(r, c)]
        px = to_pixel_art(rgb[ys, xs], (mask[ys, xs] & lab).astype(np.float32), spec.get('scale', SCALE))
        facing = fname.split('_')[0]
        # Side and diagonal frames must face right; the game mirrors them for the left half.
        # Back-diagonal views are checked by hand (seen from behind, the marker sits on the far side).
        auto = spec.get('auto_facing', True) and facing in ('side', 'downside') or (unit == 'boar' and facing == 'upside')
        if auto:
            sign = facing_sign(unit, px)
            if sign < 0:
                px = px[:, ::-1]
            elif sign == 0:
                print(f'  ?? {name} {fname}: facing unclear, using manual flip={flip}', file=sys.stderr)
                if flip:
                    px = px[:, ::-1]
        elif flip:
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


# --- Elven environment sheet (dark background) -------------------------------------------------
ELVEN_SRC = os.path.join(ROOT, 'art-source', 'elven-sheet-2.png')

# Props: name -> (x0, y0, x1, y1) box on the sheet (boxes found automatically from the alpha
# channel, then named by hand). Opaque pixels inside the box are kept; the sheet's soft shadows
# and glow halos are semi-transparent and get dropped.
ELVEN_PROPS = {
    'oak_0': (534, 17, 670, 178),
    'oak_1': (1356, 7, 1512, 176),
    'oak_2': (542, 189, 620, 280),
    'oak_3': (855, 178, 968, 282),
    'oak_4': (985, 208, 1059, 278),
    'oak_5': (1096, 201, 1167, 279),
    'blossom': (634, 189, 723, 282),
    'autumn_0': (685, 13, 806, 171),
    'autumn_1': (741, 177, 832, 281),
    'pine_0': (814, 12, 920, 174),
    'pine_1': (1201, 8, 1295, 180),
    'pine_2': (1297, 62, 1359, 177),
    'pine_3': (1173, 183, 1245, 279),
    'violet_giant': (926, 8, 1190, 208),
    'violet_0': (1264, 188, 1380, 282),
    'violet_1': (1397, 186, 1516, 283),
    'bush_0': (773, 295, 845, 362),
    'bush_1': (857, 297, 924, 360),
    'bush_2': (1010, 286, 1073, 356),
    'bush_3': (1088, 294, 1155, 357),
    'bush_flower_0': (549, 287, 653, 359),
    'bush_flower_1': (676, 289, 757, 362),
    'bush_autumn': (1175, 290, 1251, 354),
    'log_0': (1401, 293, 1510, 363),
    'log_1': (867, 432, 990, 499),
    'stump_0': (924, 368, 1011, 422),
    'mushrooms': (610, 430, 678, 492),
    'runestone_0': (1283, 368, 1367, 498),
    'runestone_1': (1440, 380, 1519, 510),
    'runestone_2': (1373, 358, 1443, 498),
    'rock_2': (677, 451, 753, 534),
    'rock_3': (762, 429, 850, 513),
    'rock_4': (688, 531, 814, 600),
    'rubble': (895, 501, 975, 588),
    'ruin_block': (830, 507, 915, 598),
    'rock_0': (1035, 361, 1105, 422),
    'rock_1': (1240, 382, 1296, 439),
    'crystal_0': (1184, 373, 1234, 437),
    'crystal_1': (1290, 503, 1358, 594),
    'crystal_2': (1374, 507, 1438, 589),
    'crystal_3': (1456, 534, 1505, 592),
    'ruin_pillar': (602, 507, 669, 601),
    'ruin_wall': (1003, 428, 1069, 507),
    'ruin_arch': (1060, 440, 1191, 617),
    'elf_pillar_0': (1197, 458, 1260, 589),
    'rune_slab': (987, 514, 1045, 613),
    'stone_gate': (710, 622, 850, 782),
    'shrine': (1171, 600, 1428, 832),
    'statue': (1084, 633, 1173, 833),
    'statue_1': (1413, 608, 1520, 857),
    'moonwell': (602, 616, 701, 771),
    'arch_gate': (95, 612, 360, 770),
    'spire_lamp': (1001, 620, 1080, 825),
    'crystal_pillar': (842, 615, 892, 751),
    'banner_pole': (14, 603, 85, 768),
    'banner_pole_1': (373, 615, 440, 782),
    'banner_small_0': (906, 608, 963, 753),
    'banner_small_1': (964, 649, 1022, 778),
    'lamp_post_0': (461, 620, 518, 768),
    'lamp_post_1': (514, 617, 588, 798),
    'lamp_small': (544, 503, 594, 601),
    'lantern_post': (482, 903, 556, 1006),
    'pedestal_0': (174, 823, 210, 898),
    'altar': (576, 769, 699, 837),
    'bench_0': (147, 778, 207, 814),
    'bench_1': (216, 772, 331, 819),
    'market_stall': (12, 775, 137, 905),
    'market_stall_1': (358, 782, 496, 913),
    'signpost': (780, 772, 864, 832),
    'fence_0': (880, 761, 971, 830),
    'fence_1': (20, 917, 164, 984),
    'fence_2': (568, 895, 688, 958),
    'crates': (759, 837, 803, 911),
    'crate_0': (217, 840, 261, 890),
    'crate_1': (283, 841, 338, 897),
    'crate_small': (138, 843, 163, 885),
    'barrel_0': (510, 826, 572, 901),
    'barrel_1': (254, 920, 311, 995),
    'barrel_2': (321, 912, 374, 985),
    'sack': (184, 927, 247, 990),
    'pot_0': (593, 839, 632, 885),
    'pot_1': (648, 839, 682, 886),
    'planter_0': (697, 821, 744, 885),
    'planter_1': (621, 956, 666, 1002),
    'chest_closed': (383, 920, 463, 995),
    'flowers_0': (548, 369, 625, 426),
    'plant_0': (652, 375, 707, 426),
    'flowers_1': (728, 368, 784, 429),
    'flowers_2': (824, 368, 900, 423),
    'flowers_3': (544, 435, 588, 490),
    'flowers_4': (943, 299, 991, 356),
    'grass_0': (1266, 289, 1314, 353),
    'reeds': (1338, 288, 1382, 352),
}
ELVEN_EXCLUDE = {}
ELVEN_DECOR_NAMES = ['flowers_0', 'flowers_1', 'flowers_2', 'flowers_3', 'flowers_4', 'grass_0', 'plant_0', 'reeds']
# Small flowers and leaves in the bottom-right corner become decor automatically (flower_N).
ELVEN_DECOR_REGION = (1380, 865, 1536, 1012)
# Ground textures: plain crops (no masking), tiled by the game.
ELVEN_GROUND = {
    'ground_grass_0': (24, 20, 100, 100), 'ground_grass_1': (128, 20, 204, 100), 'ground_grass_2': (440, 20, 518, 100),
    'ground_dirt': (126, 124, 216, 212), 'ground_stone': (234, 220, 312, 280), 'ground_plaza': (342, 306, 420, 372),
    'ground_water': (136, 545, 196, 596),
}
# Glowing effects, kept unmasked for additive blending.
ELVEN_FX = {
    'fx_runes': (830, 843, 898, 904),
    'fx_crystal': (949, 843, 994, 905),
    'fx_moon': (1011, 849, 1089, 999),
    'fx_pillar_0': (1104, 848, 1179, 997),
    'fx_pillar_1': (1181, 843, 1225, 905),
    'fx_crescent': (1348, 843, 1371, 886),
    'fx_beam': (697, 924, 777, 1005),
    'fx_portal': (793, 914, 896, 1009),
    'fx_burst': (912, 917, 995, 1001),
    'fx_fountain_0': (1196, 902, 1272, 998),
    'fx_fountain_1': (1310, 905, 1367, 1005),
}


def elven_mask(rgba, strict=False):
    """Opaque pixels only: the sheet's drop shadows and glows are semi-transparent."""
    return rgba[..., 3] > (200 if strict else 128)


def cut(rgb, m, box, scale, exclude=()):
    x0, y0, x1, y1 = box
    sub = m[y0:y1, x0:x1].copy()
    for ex0, ey0, ex1, ey1 in exclude:
        sub[max(0, ey0 - y0): max(0, ey1 - y0), max(0, ex0 - x0): max(0, ex1 - x0)] = False
    lab, n = ndimage.label(sub)
    if n > 1:
        sizes = ndimage.sum(sub, lab, range(1, n + 1))
        sub = np.isin(lab, np.nonzero(sizes >= max(10, sizes.max() * 0.03))[0] + 1)
    px = to_pixel_art(rgb[y0:y1, x0:x1], sub.astype(np.float32), scale)
    on = np.nonzero(px[..., 3])
    return px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]


def pack_atlas(images, name, width=1024):
    """Shelf-pack images into one atlas PNG + Phaser JSON hash."""
    order = sorted(images, key=lambda k: -images[k].shape[0])
    x = y = shelf = 0
    pos = {}
    for k in order:
        h, w = images[k].shape[:2]
        if x + w > width:
            x, y, shelf = 0, y + shelf + 1, 0
        pos[k] = (x, y)
        x += w + 1
        shelf = max(shelf, h)
    sheet = np.zeros((y + shelf, width, 4), np.uint8)
    frames = {}
    for k, (fx, fy) in pos.items():
        h, w = images[k].shape[:2]
        sheet[fy: fy + h, fx: fx + w] = images[k]
        frames[k] = {
            'frame': {'x': fx, 'y': fy, 'w': w, 'h': h}, 'rotated': False, 'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'sourceSize': {'w': w, 'h': h},
        }
    Image.fromarray(sheet).save(os.path.join(OUT, f'{name}.png'))
    with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
        json.dump({'frames': frames, 'meta': {'image': f'{name}.png', 'size': {'w': width, 'h': sheet.shape[0]}, 'scale': '1'}}, f, indent=1)
    print(name, len(frames), 'frames', f'{width}x{sheet.shape[0]}')


# World scale of the environment: the hero is ~27px tall, so a tree should be 2-3x that.
# Props are sliced finer than units (fewer source px per texel) to come out bigger in game.
ELVEN_SCALE = 1.25
# Buildings and the landmark tree are bigger again.
ELVEN_BIG = {'shrine', 'statue', 'statue_1', 'arch_gate', 'stone_gate', 'moonwell', 'market_stall', 'market_stall_1', 'violet_giant'}
ELVEN_BIG_SCALE = 1.6
# Per-prop overrides: this sheet draws some structures smaller, so they are cut finer.
ELVEN_SCALES = {
    # Structures stay big.
    'shrine': 1.0, 'moonwell': 1.0, 'statue': 1.15, 'statue_1': 1.15, 'arch_gate': 1.2, 'stone_gate': 1.15,
    'violet_giant': 1.3,
    # Human-scale props: a stall is ~1.5 heroes wide, a lamp post ~2 heroes tall.
    'market_stall': 1.9, 'market_stall_1': 1.9, 'spire_lamp': 1.9, 'lamp_post_0': 1.9, 'lamp_post_1': 1.9,
    'lantern_post': 1.9, 'lamp_small': 1.9, 'banner_pole': 1.8, 'banner_pole_1': 1.8, 'banner_small_0': 1.8,
    'banner_small_1': 1.8, 'crystal_pillar': 1.8, 'elf_pillar_0': 1.6, 'signpost': 1.8, 'bench_0': 1.8, 'bench_1': 1.8,
    'fence_0': 1.8, 'fence_1': 1.8, 'fence_2': 1.8, 'barrel_0': 2.0, 'barrel_1': 2.0, 'barrel_2': 2.0,
    'crates': 2.0, 'crate_0': 2.0, 'crate_1': 2.0, 'crate_small': 2.0, 'sack': 2.0, 'pot_0': 2.0, 'pot_1': 2.0,
    'planter_0': 2.0, 'planter_1': 2.0, 'altar': 1.7, 'pedestal_0': 1.8, 'chest_closed': 1.6,
}
# Ground detail stays small.
ELVEN_DECOR_SCALE = 2.2


def slice_elven():
    rgba = np.array(Image.open(ELVEN_SRC).convert('RGBA')).astype(np.float32)
    rgb = rgba[..., :3]
    m = elven_mask(rgba)
    m_strict = elven_mask(rgba, strict=True)
    glowing = {'crystal_0', 'crystal_1', 'crystal_2', 'crystal_3'}
    images = {
        name: cut(rgb, m_strict if name in glowing else m, box,
                  ELVEN_SCALES.get(name, ELVEN_BIG_SCALE if name in ELVEN_BIG else ELVEN_DECOR_SCALE if name in ELVEN_DECOR_NAMES else ELVEN_SCALE),
                  ELVEN_EXCLUDE.get(name, ()))
        for name, box in ELVEN_PROPS.items()
    }
    # Auto decor: every small blob in the flower field.
    x0, y0, x1, y1 = ELVEN_DECOR_REGION
    sub = m[y0:y1, x0:x1]
    lab, _ = ndimage.label(ndimage.binary_dilation(sub, iterations=2))
    k = 0
    for sl in ndimage.find_objects(lab):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (18 <= h <= 60 and 16 <= w <= 60):
            continue
        box = (x0 + sl[1].start, y0 + sl[0].start, x0 + sl[1].stop, y0 + sl[0].stop)
        images[f'flower_{k}'] = cut(rgb, m, box, ELVEN_DECOR_SCALE)
        k += 1
    for name, box in ELVEN_GROUND.items():
        # Shrink the crop until every pixel is opaque: the tiles have transparent gutters whose
        # hidden colours would otherwise leak into the ground palette.
        gx0, gy0, gx1, gy1 = box
        alpha = rgba[..., 3]
        while gx1 - gx0 > 8 and gy1 - gy0 > 8:
            sub = alpha[gy0:gy1, gx0:gx1]
            if sub.min() >= 250:
                break
            edges = [sub[0].min(), sub[-1].min(), sub[:, 0].min(), sub[:, -1].min()]
            k = int(np.argmin(edges))
            if k == 0: gy0 += 1
            elif k == 1: gy1 -= 1
            elif k == 2: gx0 += 1
            else: gx1 -= 1
        crop = Image.fromarray(rgb[gy0:gy1, gx0:gx1].astype(np.uint8))
        crop = crop.resize((round((gx1 - gx0) / SCALE), round((gy1 - gy0) / SCALE)), Image.BOX)
        arr = np.zeros((crop.height, crop.width, 4), np.uint8)
        arr[..., :3] = np.array(crop)
        arr[..., 3] = 255
        images[name] = arr
    for name, (fx0, fy0, fx1, fy1) in ELVEN_FX.items():
        crop = Image.fromarray(rgb[fy0:fy1, fx0:fx1].astype(np.uint8))
        crop = crop.resize((round((fx1 - fx0) / SCALE), round((fy1 - fy0) / SCALE)), Image.BOX)
        arr = np.zeros((crop.height, crop.width, 4), np.uint8)
        # Additive blending: premultiply by alpha so transparent areas add nothing.
        a = np.array(Image.fromarray(rgba[fy0:fy1, fx0:fx1, 3].astype(np.uint8)).resize(crop.size, Image.BOX)).astype(np.float32) / 255
        arr[..., :3] = (np.array(crop).astype(np.float32) * a[..., None]).astype(np.uint8)
        arr[..., 3] = 255
        images[name] = arr
    pack_atlas(images, 'elven')
    print('  decor flowers:', k)
    # Sizes in world px (drawn at half the texel density) help choose footprints in src/world/props.ts.
    sizes = {n: (round(im.shape[1] / 2), round(im.shape[0] / 2)) for n, im in images.items() if not n.startswith(('flower', 'ground', 'fx'))}
    print('  world px:', ' '.join(f'{n}={w}x{h}' for n, (w, h) in sorted(sizes.items())))


# --- Item icons -------------------------------------------------------------------------------
ITEMS_SRC = os.path.join(ROOT, 'art-source', 'items-sheet.png')
ITEM_SCALE = 2.9  # ~32px icons
# Categories in reading order (band by band, left to right), with how many cells each has.
ITEM_CATEGORIES = [
    ('bow', 6), ('quiver', 6), ('dagger', 6),
    ('helmet', 6), ('chest', 6), ('gloves', 6),
    ('boots', 6), ('ring', 6), ('amulet', 7),
    ('belt', 6), ('cloak', 6), ('potion', 6),
    ('food', 8), ('material', 8),
    ('rare', 8), ('quest', 8), ('misc', 8),
]


def item_cells(lum):
    """
    Cell boxes on the item sheet: dark grey cells on black. Cells within a category touch
    (gaps of a few px), categories are separated by wide gaps, so each band's runs are merged
    into category groups and every group is divided by its known cell count.
    """
    on = lum > 10

    def runs(v, minlen):
        out, start = [], None
        for i, x in enumerate(v):
            if x and start is None:
                start = i
            if not x and start is not None:
                if i - start >= minlen:
                    out.append((start, i))
                start = None
        if start is not None and len(v) - start >= minlen:
            out.append((start, len(v)))
        return out

    counts = [n for _, n in ITEM_CATEGORIES]
    boxes = []
    for y0, y1 in runs(on.mean(axis=1) > 0.02, 60):
        groups = []
        for x0, x1 in runs(on[y0:y1].mean(axis=0) > 0.5, 40):
            if groups and x0 - groups[-1][1] < 15:
                groups[-1][1] = x1
            else:
                groups.append([x0, x1])
        for gx0, gx1 in groups:
            n = counts.pop(0)
            w = (gx1 - gx0) / n
            for j in range(n):
                boxes.append((int(gx0 + j * w), y0, int(gx0 + (j + 1) * w), y1))
    return boxes


def slice_items():
    rgb = np.array(Image.open(ITEMS_SRC).convert('RGB')).astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    boxes = item_cells(lum)
    names = [f'{cat}_{i}' for cat, n in ITEM_CATEGORIES for i in range(n)]
    if len(boxes) != len(names):
        print(f'  !! items: found {len(boxes)} cells, expected {len(names)}', file=sys.stderr)
    images = {}
    for name, (x0, y0, x1, y1) in zip(names, boxes):
        # Icon = anything that isn't the flat dark cell background; shave the cell's rounded border.
        pad = 6
        sub = rgb[y0 + pad: y1 - pad, x0 + pad: x1 - pad]
        sl = lum[y0 + pad: y1 - pad, x0 + pad: x1 - pad]
        ss = sat[y0 + pad: y1 - pad, x0 + pad: x1 - pad]
        m = (sl > 48) | (ss > 24)
        m = ndimage.binary_opening(m, iterations=1)
        holes = ndimage.binary_fill_holes(m) & ~m
        lab, n = ndimage.label(holes)
        if n:
            sizes = ndimage.sum(holes, lab, range(1, n + 1))
            m |= np.isin(lab, np.nonzero(sizes < 60)[0] + 1)
        lab, n = ndimage.label(m)
        if n > 1:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            m = np.isin(lab, np.nonzero(sizes >= max(8, sizes.max() * 0.02))[0] + 1)
        px = to_pixel_art(sub, m.astype(np.float32), ITEM_SCALE)
        on = np.nonzero(px[..., 3])
        images[name] = px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]
    pack_atlas(images, 'items', width=512)


# --- Hunter magic shot sheet (cast animation + projectile + impact + trail) --------------------
MAGIC_SRC = os.path.join(ROOT, 'art-source', 'magic-shot-sheet.png')
# Hunter cast cells: 8 rows (facings in sheet order) x 4 frames. Cell grid measured from the sheet.
# Game facings per sheet row, by what the art shows (the sheet's labels are off for several rows;
# the game mirrors right-facing frames for the left side): rows 1,2 aim right-down, 3 right, 4 up-right.
MAGIC_HUNTER_ROWS = ['down', 'downside', 'side', 'upside', 'up', 'alt_upside', 'alt_side', 'alt_downside']
MAGIC_HUNTER_GRID = (96, 44, 92, 60, 72, 56)  # x0, y0, dx, dy, cell w, cell h
# FX strips: 8 cells each, (x0, y0, dx, w, h)
MAGIC_FX = {
    'bolt': (474, 92, 104, 96, 80),
    'impact': (474, 250, 104, 96, 90),
    'trail': (474, 412, 104, 96, 90),
}
MAGIC_SCALE = 1.0  # hunter art is ~55px tall on the sheet; kept 1:1 so it matches the archer atlas (2x density)
MAGIC_FX_SCALE = 2.0


def slice_magic():
    rgb = np.array(Image.open(MAGIC_SRC).convert('RGB')).astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    sprite = (lum > 75) | (sat > 45)
    holes = ndimage.binary_fill_holes(sprite) & ~sprite
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, range(1, n + 1))
        sprite |= np.isin(lab, np.nonzero(sizes < 60)[0] + 1)
    images = {}
    x0, y0, dx, dy, cw, ch = MAGIC_HUNTER_GRID
    for r, facing in enumerate(MAGIC_HUNTER_ROWS):
        for c in range(4):
            bx0, by0 = x0 + c * dx, y0 + r * dy
            box = (bx0, by0, bx0 + cw, by0 + ch)
            sub = sprite[by0: by0 + ch, bx0: bx0 + cw]
            px = to_pixel_art(rgb[by0: by0 + ch, bx0: bx0 + cw], sub.astype(np.float32), MAGIC_SCALE)
            on = np.nonzero(px[..., 3])
            images[f'cast_{facing}_{c}'] = px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]
    # FX frames: keep the glow, so no hole filling / fragment dropping; take every bright pixel in the cell
    # and keep colour premultiplied by a soft alpha (brightness) for additive blending.
    for name, (fx0, fy0, fdx, fw, fh) in MAGIC_FX.items():
        for c in range(8):
            bx0, by0 = fx0 + c * fdx, fy0
            sub = rgb[by0: by0 + fh, bx0: bx0 + fw]
            sl = sub.mean(axis=2)
            ss = sub.max(axis=2) - sub.min(axis=2)
            a = np.clip((np.maximum(sl - 50, 0) / 120) + (ss / 160), 0, 1)
            a[a < 0.12] = 0
            nw, nh = round(fw / MAGIC_FX_SCALE), round(fh / MAGIC_FX_SCALE)
            pre = Image.fromarray(np.clip(sub * a[..., None], 0, 255).astype(np.uint8)).resize((nw, nh), Image.BOX)
            arr = np.zeros((nh, nw, 4), np.uint8)
            arr[..., :3] = np.array(pre)
            arr[..., 3] = 255
            images[f'{name}_{c}'] = arr
    pack_atlas(images, 'magic', width=512)


# --- Hunter sky-arrow sheet (Rain of Arrows: cast, falling arrows, ground mark, impact, scatter) ---
SKY_SRC = os.path.join(ROOT, 'art-source', 'sky-arrow-sheet.png')
# Each strip: (y0, y1, x0, x1, frame count). Frames are evenly spaced across the strip; the sparse
# effect frames break into fragments if segmented, so even columns are used instead.
SKY_STRIPS = {
    'skycast': (40, 150, 14, 1160, 10),
    'skyarrow': (175, 345, 40, 1520, 14),
    'skymark': (395, 515, 14, 1520, 10),
    'skyhit': (535, 680, 14, 1520, 10),
    'skyscatter': (720, 790, 14, 1520, 10),
}
SKY_SCALE = 2.0


def sky_mask(rgb):
    """Everything that isn't the baked-in checkerboard (neutral greys)."""
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    return (sat > 28) | (lum < 110)


def slice_sky():
    rgb = np.array(Image.open(SKY_SRC).convert('RGB')).astype(np.float32)
    m = sky_mask(rgb)
    images = {}
    for name, (y0, y1, x0, x1, n) in SKY_STRIPS.items():
        w = (x1 - x0) / n
        for i in range(n):
            bx0, bx1 = int(x0 + i * w), int(x0 + (i + 1) * w)
            sub = rgb[y0:y1, bx0:bx1]
            sm = m[y0:y1, bx0:bx1]
            if name == 'skycast':
                # Solid sprite: clean outline, drop stray specks.
                lab, k = ndimage.label(sm)
                if k > 1:
                    sizes = ndimage.sum(sm, lab, range(1, k + 1))
                    sm = np.isin(lab, np.nonzero(sizes >= max(10, sizes.max() * 0.03))[0] + 1)
                px = to_pixel_art(sub, sm.astype(np.float32), SKY_SCALE)
            else:
                # Glowing effect: soft alpha from brightness/saturation, premultiplied for additive blending.
                sl = sub.mean(axis=2)
                ss = sub.max(axis=2) - sub.min(axis=2)
                a = np.clip(ss / 110 + np.maximum(sl - 175, 0) / 80, 0, 1)
                a[~sm] = 0
                nw, nh = round(sub.shape[1] / SKY_SCALE), round(sub.shape[0] / SKY_SCALE)
                pre = Image.fromarray(np.clip(sub * a[..., None], 0, 255).astype(np.uint8)).resize((nw, nh), Image.BOX)
                px = np.zeros((nh, nw, 4), np.uint8)
                px[..., :3] = np.array(pre)
                px[..., 3] = 255
            if name == 'skycast':
                on = np.nonzero(px[..., 3])
                px = px[on[0].min(): on[0].max() + 1, on[1].min(): on[1].max() + 1]
            images[f'{name}_{i}'] = px
    pack_atlas(images, 'sky', width=1024)


def main():
    rgb, mask = load()
    if '--contact' in sys.argv:
        contact(sys.argv[sys.argv.index('--contact') + 1], rgb, mask)
        return
    for name, spec in SHEETS.items():
        pack(name, spec, rgb, mask)
    arrow()
    slice_elven()
    slice_items()
    slice_magic()
    slice_sky()


if __name__ == '__main__':
    main()
