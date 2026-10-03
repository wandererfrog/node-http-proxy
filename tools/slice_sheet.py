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


# --- Elven environment sheet (dark background) -------------------------------------------------
ELVEN_SRC = os.path.join(ROOT, 'art-source', 'elven-sheet.png')

ELVEN_PROPS = {
    # trees
    'oak_0': (438, 8, 562, 158), 'oak_1': (444, 158, 526, 256), 'oak_2': (528, 122, 636, 214), 'oak_3': (640, 150, 738, 258),
    'autumn_0': (564, 4, 662, 122), 'pine_0': (656, 10, 712, 130), 'pine_1': (712, 14, 762, 128),
    'violet_giant': (722, 4, 1012, 284), 'violet_0': (972, 8, 1034, 66),
    'violet_1': (1066, 190, 1146, 286), 'violet_2': (1336, 186, 1420, 268),
    # bushes / shrubs
    'bush_0': (524, 206, 578, 258), 'bush_autumn_0': (586, 204, 640, 258), 'bush_1': (446, 258, 492, 326),
    'bush_violet': (494, 258, 556, 326), 'bush_2': (558, 262, 614, 326), 'bush_3': (616, 248, 670, 328),
    'bush_4': (672, 272, 714, 306), 'bush_5': (716, 274, 758, 306), 'bush_flower': (444, 326, 550, 422),
    'bush_autumn_1': (674, 316, 754, 376), 'bush_6': (552, 330, 614, 384),
    # wood
    'log_0': (582, 388, 702, 468), 'stump_0': (702, 426, 746, 462), 'log_1': (816, 546, 948, 634),
    'stump_moss': (684, 470, 812, 568), 'mushrooms': (786, 616, 864, 702),
    # stones
    'runestone_0': (752, 330, 838, 448), 'runestone_1': (840, 280, 914, 414), 'runestone_2': (916, 316, 998, 430),
    'rock_0': (606, 506, 702, 642), 'rock_1': (812, 446, 908, 548), 'rock_2': (866, 644, 952, 708),
    'rubble': (960, 666, 1094, 712),
    # crystals (searchable)
    'crystal_0': (748, 546, 814, 618), 'crystal_1': (504, 588, 554, 642), 'crystal_2': (892, 824, 946, 884),
    # ruins
    'ruin_pillar': (504, 704, 562, 794), 'ruin_wall': (508, 762, 606, 892), 'ruin_arch': (602, 702, 744, 894),
    'ruin_block': (564, 704, 608, 758), 'elf_pillar_0': (750, 720, 810, 864), 'elf_pillar_1': (818, 710, 874, 864),
    'runestone_3': (874, 742, 942, 862), 'rune_slab': (444, 774, 502, 892),
    # elven structures
    'shrine': (1068, 0, 1422, 302), 'statue': (1412, 2, 1536, 278), 'spire_lamp': (1002, 60, 1066, 318),
    'arch_gate': (1082, 304, 1378, 506), 'crystal_pillar': (1382, 294, 1452, 502), 'banner_pole': (1458, 286, 1536, 528),
    'banner_pole_1': (1004, 320, 1076, 500), 'moonwell': (1164, 424, 1358, 618),
    'pedestal_0': (906, 438, 946, 532), 'pedestal_orb': (946, 450, 988, 514), 'pedestal_1': (988, 438, 1032, 530),
    'bench': (1034, 510, 1132, 568), 'altar': (954, 528, 1042, 662), 'market_stall': (1374, 524, 1536, 678),
    'banner_small': (1046, 576, 1096, 666), 'lamp_post': (1098, 572, 1152, 702),
    'signpost': (942, 718, 1014, 832), 'fence_0': (1016, 724, 1112, 788), 'lantern_post': (1122, 678, 1226, 836),
    'cart': (1220, 686, 1398, 834), 'crates': (1396, 706, 1452, 782), 'barrel': (1474, 750, 1524, 828),
    'crate': (1396, 780, 1446, 832), 'sack': (1440, 776, 1486, 832), 'well': (948, 792, 1064, 894),
    'pot': (1066, 806, 1114, 858), 'sacks': (1098, 832, 1172, 894),
    'fence_1': (1190, 838, 1280, 894), 'fence_2': (1294, 838, 1390, 894), 'fence_3': (1404, 838, 1514, 894),
    # water decor
    'reeds': (444, 704, 502, 772),
}
# Pieces of neighbours that fall inside a prop's box.
ELVEN_EXCLUDE = {'arch_gate': [(1186, 416, 1274, 506)]}
# Small flowers / sprouts in this region become decor automatically (flower_N).
ELVEN_DECOR_REGION = (444, 452, 780, 702)
ELVEN_GROUND = {
    'ground_grass_0': (12, 506, 108, 540), 'ground_grass_1': (358, 262, 430, 296), 'ground_grass_2': (272, 12, 344, 84),
    'ground_dirt': (196, 190, 236, 246), 'ground_stone': (104, 350, 166, 400), 'ground_plaza': (190, 350, 252, 400),
    'ground_water': (140, 630, 205, 680),
}
# Glowing effects, kept unmasked for additive blending.
ELVEN_FX = {
    'fx_moon': (824, 902, 898, 1006), 'fx_runes': (234, 902, 332, 1006), 'fx_crescent': (438, 904, 510, 1002),
    'fx_portal': (902, 898, 1016, 1006), 'fx_burst': (1018, 898, 1146, 1006), 'fx_well': (118, 900, 226, 1006),
}


def elven_mask(rgb):
    bg = np.array([32.0, 36.0, 41.0])
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    lum = rgb.mean(axis=2)
    # Glow halos are dim, blue-tinted and close to the background: treat them as background.
    halo = (lum < 70) & (rgb[..., 2] > rgb[..., 0] + 14) & (d < 60)
    m = (d > 16) & ~halo
    m = ndimage.binary_opening(m, iterations=1)
    holes = ndimage.binary_fill_holes(m) & ~m
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, range(1, n + 1))
        m |= np.isin(lab, np.nonzero(sizes < 80)[0] + 1)
    return m


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


def slice_elven():
    rgb = np.array(Image.open(ELVEN_SRC).convert('RGB')).astype(np.float32)
    m = elven_mask(rgb)
    images = {name: cut(rgb, m, box, SCALE, ELVEN_EXCLUDE.get(name, ())) for name, box in ELVEN_PROPS.items()}
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
        images[f'flower_{k}'] = cut(rgb, m, box, SCALE)
        k += 1
    for name, (gx0, gy0, gx1, gy1) in ELVEN_GROUND.items():
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
        # Additive blending: subtract the background so it adds nothing.
        arr[..., :3] = np.clip(np.array(crop).astype(np.float32) - np.array([32, 36, 41]), 0, 255).astype(np.uint8)
        arr[..., 3] = 255
        images[name] = arr
    pack_atlas(images, 'elven')
    print('  decor flowers:', k)


def main():
    rgb, mask = load()
    if '--contact' in sys.argv:
        contact(sys.argv[sys.argv.index('--contact') + 1], rgb, mask)
        return
    for name, spec in SHEETS.items():
        pack(name, spec, rgb, mask)
    arrow()
    slice_elven()


if __name__ == '__main__':
    main()
