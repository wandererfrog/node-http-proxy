# Ranger Quest

A top-down pixel-art action RPG: old-school Zelda look, **Warcraft III hero controls**.
Built with [Phaser 3](https://phaser.io) + TypeScript + Vite. **Mobile first** (touch), and it also plays with mouse and keyboard.

Unit art (the archer, boars, skeletons, arrows) comes from the concept sheet in `art-source/sprite-sheet.png`.
`tools/slice_sheet.py` cuts it into game-ready pixel-art atlases in `src/assets/sprites/`.
Terrain, props and HUD icons are drawn in code (`src/art/sprites.ts`).

### Re-slicing the sprite sheet

```bash
pip install pillow numpy scipy
python3 tools/slice_sheet.py
```

The source sheet is not a regular grid, and some of its frames face a different way from their column label.
So the slicer finds each sprite automatically, and `picks` in the script chooses which one to use for each frame (`down` / `up` / `side` × `idle`, `walk1`, `walk2`, `attack`, `shoot`, `death`).
Side frames are stored facing right, and the game mirrors them for left.
The alpha boar is the same art sliced at a finer scale, so it's bigger without blurry upscaling.

## Run it

```bash
npm install
npm run dev        # serves on your LAN too: open the printed "Network" URL on your phone
npm test           # pathfinding / map / sprite sanity tests
npm run build      # static build in dist/ (relative paths, so it works from any static host)
```

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Move | tap the ground | left or right click |
| Attack | tap an enemy | click an enemy |
| Pan camera | drag one finger | arrow keys |
| Zoom | pinch | mouse wheel |
| Re-center | **Follow** button | Space |
| Ability | tap the button, then tap the map, **or drag from the button to aim** (release on the button to cancel) | Q W E R, then click (right-click or Esc cancels) |
| Ability info | long-press the button | hover |
| Learn ability | the yellow **+** on the button | **+**, or Ctrl+Q/W/E/R |
| Attack-move / Hold / Stop | big A button + H / S, bottom-left (left thumb) | A / H / S |
| Queue orders | — | hold Shift |

## How the movement works (the WC3 feel)

- **Pathfinding** (`src/world/pathfinding.ts`): 8-directional A* that never cuts past blocked corners, then *string-pulling*, so the hero walks straight lines across open ground instead of zig-zagging from tile to tile. Clicking on a tree or water sends you to the nearest walkable spot.
- **Speed and turn rate**: like WC3, the hero walks about half its attack range per second (46 px/s with a 96 px range). Units turn in place before walking off, about 0.33s for a full 180°.
- **Attack timing**: each attack has a *damage point* (when the arrow leaves the bow) and a *backswing*. Issuing a move during the windup cancels the attack with no cooldown spent. Moving during the backswing cancels it, so the classic orb-walk / attack-cancel tricks work.
- **Auto-acquire**: an idle hero shoots enemies that come into range and fights back when hit. Attack-move fights everything on the way, Hold position only shoots what is already in range.
- **Casting out of range** walks into range first and then casts. Blink-style abilities (Tumble) clamp to max range instead.
- **Unit separation**: bodies push each other apart. Standing units are "heavier", so walkers flow around them, and pushes never shove anyone into walls.
- The simulation uses real frame time, so slow phones don't play in slow motion.

## The Ranger's kit

| Key | Ability | |
|---|---|---|
| Q | **Searing Arrows** | Autocast toggle. Attacks deal bonus fire damage for 8 mana each. |
| W | **Volley** | A cone of 5/7/9 arrows. Each one hits the first enemy in its path, so point-blank shots do huge burst damage. |
| E | **Tumble** | A short dash that stops at obstacles. Your next attack within 4s fires instantly for 150/175/200% damage. |
| R | **Rain of Arrows** (ultimate, hero level 4/8) | Channel for 3s: 6 waves of arrows hit an area. Any new order cancels it. |

Abilities level up WC3-style: a skill point per hero level, and basic abilities need hero level 1/3/5.

## Creeps

Skeleton camps sit near the start and boar packs (led by an alpha boar) further out, each around a campfire. Camps aggro together, leash home (regenerating) if you drag them too far, and respawn 45s after being cleared once you're not standing on top of them.

## Code map

```
src/
  main.ts                 Phaser boot (DPR-aware canvas, mobile gesture blocking)
  scenes/GameScene.ts     world setup, input (tap / drag / pinch / aim), camera, overlays, game loop
  entities/Unit.ts        orders, pathing, turning, attack windup/backswing, separation
  entities/Hero.ts        mana, XP/levels, casting, channelling, dash
  entities/Creep.ts       camp AI: group aggro, leash, regen
  entities/Projectile.ts  homing and skillshot arrows
  abilities/              Ability base class and the Ranger kit
  world/map.ts            seeded map generation (forests, lakes, roads to every camp)
  world/pathfinding.ts    A*, line of walk, path smoothing
  art/                    terrain/props/icons drawn in code, atlas animation setup
  assets/sprites/         unit atlases generated from art-source/ by tools/slice_sheet.py
  ui/hud.ts               DOM HUD: hero frame, minimap, command card, tooltips
```
