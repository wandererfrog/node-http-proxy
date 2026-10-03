# Hero sprite brief: the Ranger

Brief for an artist or image-generation agent. The game needs a full 8-direction sprite set of the ranger from the concept sheet. The concept art has the right look. It can't be used directly, because its directions don't face the way they're labelled and walking and attacking are drawn side-on only.

## Files in this folder

| File | What it is |
|---|---|
| `style-reference.png` | The ranger to draw, cut from the concept sheet: idle, basic attack and run. **Match this character and style.** |
| `direction-guide.png` | The current in-game archer in all 5 directions. **Use it only to see which way each sheet faces.** Don't copy its style. |
| `layout-template.png` | The grid every sheet must follow: 16 frames, their order, the feet line and the top-of-hood line. Its guides and labels are for you only. Don't draw them. |

## What to deliver

Five PNG files, one per direction:

| File | Direction |
|---|---|
| `hero-down.png` | Facing the camera (south). Face fully visible. |
| `hero-downside.png` | Front three-quarter, turned to the **right** (south-east). Face and right side visible. |
| `hero-side.png` | Full profile facing **right** (east). |
| `hero-upside.png` | Back three-quarter, turned to the **right** (north-east). Mostly back and quiver, a sliver of cheek. |
| `hero-up.png` | Back to the camera (north). No face visible. |

Only these five are needed. The game mirrors the three right-facing views to get the left-facing ones. So "right" must really mean right, in every frame of those three sheets.

### Sheet format (every file)

- **1024 × 1024 px**, a **4 × 4 grid of 256 × 256 cells**, read left to right, top to bottom.
- **Transparent background** (PNG with alpha). If transparency isn't possible, use flat **#FF00FF** magenta everywhere, with no gradient or noise.
- **No** grid lines, labels, numbers, text, borders or frames.
- Each character sits inside its own cell, with at least 8 px of empty space to every cell edge, bow included.

### Size and alignment (most important)

- In every cell, the **feet rest on the same line: y = 236** within the cell, 20 px above the cell's bottom edge.
- The **top of the hood is at about y = 36**, so the character is about **200 px tall** standing. That's the same height in every frame and every file.
- The **body is centred horizontally** in the cell, at x = 128. Centre the body, not the bow.
- Same proportions, same palette, same costume in all 80 frames. The game swaps frames many times a second, so any drift shows as wobbling.

### The 16 frames (same order in every file)

| # | Frame | Pose |
|---|---|---|
| 1 | `idle_0` | Standing, relaxed, bow held low in the bow hand |
| 2 | `idle_1` | Same as 1 with a slight breath: shoulders 2 to 4 px higher. Feet don't move. |
| 3 | `walk_0` | Walk: right foot forward, contact |
| 4 | `walk_1` | Walk: passing, feet together, body slightly up |
| 5 | `walk_2` | Walk: left foot forward, contact |
| 6 | `walk_3` | Walk: passing, feet together, body slightly up |
| 7 | `attack_0` | Attack: nock an arrow, bow raised toward the facing direction |
| 8 | `attack_1` | Attack: full draw, arrow on the string pointing in the facing direction |
| 9 | `attack_2` | Attack: release. The string is forward and the arrow is gone. Don't draw the flying arrow. |
| 10 | `attack_3` | Attack: recover, bow lowering |
| 11 | `cast_0` | Cast: bow raised up toward the sky, arrow nocked (Rain of Arrows) |
| 12 | `cast_1` | Cast: full draw aimed straight up at the sky |
| 13 | `hurt` | Flinch backwards, away from the facing direction |
| 14 | `death_0` | Stagger, knees buckling |
| 15 | `death_1` | Falling |
| 16 | `death_2` | Lying on the ground. The feet line still marks the ground. |

The bow and the attack always point in the sheet's facing direction: toward the viewer in `down`, right in `side`, away in `up`, and so on.

### Style rules

- Pixel art in the style of the reference: crisp pixels, a dark 1 px outline, limited palette, no blur or soft anti-aliasing.
- Top-down three-quarter camera, as in classic Zelda and Warcraft III. Light from the top-left.
- Costume: green hood and cloak, brown leather tunic and boots, orange-brown longbow, quiver of white-fletched arrows on the back. Keep it identical in every frame.
- **No effects baked in:** no glows, sparkles, magic, auras, motion lines, dust, arrows in flight, ground shadow or ground circle. The game adds all of those itself.

### Checklist before handing over

- [ ] 5 files, named exactly as above, each 1024 × 1024 with 16 cells in the template order.
- [ ] Transparent (or flat #FF00FF) background, with no text, lines or labels.
- [ ] Feet on y = 236 in every cell. Same height and centre in every frame.
- [ ] Right-facing sheets face right in every frame. `up` shows no face. `down` shows the full face.
- [ ] Same character, palette and costume as `style-reference.png` in all 80 frames.
- [ ] No effects, shadows or flying arrows.

## Prompt (paste one per direction)

Attach `style-reference.png`, `direction-guide.png` and `layout-template.png` to every request. Replace `{DIRECTION}` and `{FILE}` from the table below.

```
Create a pixel-art sprite sheet of the ranger shown in style-reference.png (green hood and cloak, brown leather, orange-brown longbow, quiver of white-fletched arrows on the back). Match that character and pixel-art style exactly: crisp pixels, dark 1px outline, limited palette, top-down three-quarter view like classic Zelda / Warcraft III, light from the top-left.

Direction for this whole sheet: {DIRECTION}. Every one of the 16 frames faces this way; see the matching row of direction-guide.png (use that image only for direction, not for style).

Canvas: 1024x1024 PNG with a transparent background (or flat #FF00FF if transparency is impossible). A 4x4 grid of 256x256 cells, read left to right, top to bottom, following layout-template.png, but do NOT draw any grid lines, labels, numbers or text.

In every cell: the feet stand on y=236 of the cell, the top of the hood is at about y=36 (character about 200px tall), and the body is centred at x=128. Keep at least 8px of space to every cell edge, bow included. Same size, proportions, palette and costume in all 16 frames.

Frames in order:
1 idle; 2 idle with a slight breath (shoulders 2-4px higher, feet still);
3 walk, right foot forward; 4 walk, passing; 5 walk, left foot forward; 6 walk, passing;
7 attack, nocking an arrow; 8 attack, full draw aimed in the facing direction; 9 attack, release (string forward, no flying arrow); 10 attack, recover;
11 cast, bow raised toward the sky; 12 cast, full draw aimed straight up;
13 hurt, flinching backwards; 14 death, staggering; 15 death, falling; 16 death, lying on the ground.

No effects at all: no glows, sparkles, magic, auras, motion lines, dust, ground shadows, ground circles or arrows in flight. Output only the sheet. File name: {FILE}.
```

| `{FILE}` | `{DIRECTION}` |
|---|---|
| `hero-down.png` | facing the camera (south); the face is fully visible |
| `hero-downside.png` | front three-quarter view turned to the RIGHT (south-east); face and right side visible |
| `hero-side.png` | full side profile facing RIGHT (east) |
| `hero-upside.png` | back three-quarter view turned to the RIGHT (north-east); mostly back and quiver, a sliver of cheek |
| `hero-up.png` | back to the camera (north); no face visible, hood, cloak and quiver visible |

## What happens next

Put the five PNGs in `art-source/hero/`. `tools/slice_sheet.py` will cut each 256 px cell down to the game's hero size (about 43 px tall at 2x density), anchored on the feet line. The game then gets 2-frame idle, 4-frame walk, 4-frame attack, a cast pose for Rain of Arrows, hurt and death in all 8 directions.
