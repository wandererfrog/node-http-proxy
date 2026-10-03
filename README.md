# Ranger Quest

A top-down pixel-art action RPG: old-school Zelda look, **Warcraft III hero controls**.
Built with [Phaser 3](https://phaser.io) + TypeScript + Vite. **Mobile first** (touch), and it also plays with mouse and keyboard.

Unit art (archer, boars, skeletons) comes from `art-source/units-sheet.png`.
`tools/slice_sheet.py` cuts it into pixel-art atlases in `src/assets/sprites/`.
Units face 8 directions: five drawn views (front, front ¾, side, back ¾, back), with the left half mirrored.
The atlases are sliced at 2x density and drawn at half size, so the detail survives on phone screens.
**One effects set for the hero:** every arrow, ability effect, marker and aura comes from the ranger concept sheet (`art-source/ranger-concept-sheet.png`, atlas `rangerfx`) and its aura sheet (`art-source/aura-sheet.png`, atlas `auras`). Both are scaled to the hero: the ranger in the concept panels is ~67px tall and the hero is 43px tall at 2x density, so effects are cut at 43/67 and keep the size they have next to the ranger in the concept art. The auras are cut at the sheet's own 32x32 per frame. Glows are rebuilt from the dark background as additive colour; arrows get real transparency. The concept sheet's ranger sprites aren't used for the hero (its 8 directions don't face the way they're labelled and walking/attacking is side-only), so the hero stays the units-sheet archer.

| In game | From the concept / aura sheet |
|---|---|
| Auto-attack arrow, Volley arrows, Searing Arrows | Basic attack arrow, multi-shot arrow, fire elemental arrow |
| Volley release | Multi-shot fan |
| Rain of Arrows | AOE rune circle (sized to the hit radius), basic arrow falling, arrow rain impact; focus aura while channelling |
| Tumble | Wind dash trail and wind aura |
| Aim previews | Cone, line and AOE circle indicators (stretched to each ability's reach) |
| Order markers | Target marker (move), debuff runes (attack), precision ring (search/cast) |
| Hits, deaths | Damage impact, death dust |
| Level up, skill learned, potions, moonwell | Level-up column + precision aura, buff pulse, heal / focus aura, nature aura |
The world uses the elven tileset in `art-source/elven-sheet-2.png` (transparent, well spaced): trees, crystals, rune stones, ruins, the shrine, the moonwell, banners and village props. The script finds every sprite from the alpha channel, and `ELVEN_PROPS` names the boxes; it's sliced into the `elven` atlas.
HUD icons, the chest and effects are drawn in code (`src/art/sprites.ts`).

### Re-slicing the sprite sheet

```bash
pip install pillow numpy scipy
python3 tools/slice_sheet.py                     # writes src/assets/sprites/
python3 tools/slice_sheet.py --contact /tmp/out  # labelled contact sheets for choosing frames
```

The sheet's drop shadows and glows are semi-transparent, so keeping only opaque pixels drops them.
Some columns face a different way from their neighbours (the idle and walk side frames face left, the attack frames right), so `picks` in the script maps each game frame to a sheet row/column, and the slicer checks each side/diagonal frame's facing from a marker (the archer's skin, the boar's tusks) and mirrors it to face right. The skeleton's facings are set by hand.

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
| Attack-move | big A button, bottom-left (left thumb) | A |
| Drink potion | potion slots next to the A button | 1 / 2 |
| Search a rock for potions | tap the rock | click the rock |
| Character & inventory | tap the portrait or the bag | C or I |
| Hold / Stop | — | H / S |
| Queue orders | — | hold Shift |

## How the movement works (the WC3 feel)

- **Pathfinding** (`src/world/pathfinding.ts`): 8-directional A* that never cuts past blocked corners, then *string-pulling*, so the hero walks straight lines across open ground instead of zig-zagging from tile to tile. Clicking on a tree or water sends you to the nearest walkable spot.
- **Camera**: follows the hero. Dragging pans away, and any order you give brings it back.
- **Speed and turn rate**: like WC3, the hero walks about half its attack range per second (46 px/s with a 96 px range). Units turn in place before walking off, about 0.25s for a full 180°.
- **Attack timing**: each attack has a *damage point* (when the arrow leaves the bow) and a *backswing*. Issuing a move during the windup cancels the attack with no cooldown spent. Moving during the backswing cancels it, so the classic orb-walk / attack-cancel tricks work.
- **Auto-acquire**: an idle hero shoots enemies that come into range and fights back when hit. Attack-move fights everything on the way, Hold position only shoots what is already in range.
- **Casting out of range** walks into range first and then casts. Blink-style abilities (Tumble) clamp to max range instead.
- **Unit separation**: bodies push each other apart. Standing units are "heavier", so walkers flow around them, and pushes never shove anyone into walls.
- The simulation uses real frame time, so slow phones don't play in slow motion.

## Combat balance

All tuning lives in `src/entities/balance.ts`:
- **Kill speed:** a creep of your level dies in 2–3 arrows. Creep health scales with the hero's damage at that level (checked by `tests/balance.test.ts`).
- **Kiting:** a melee creep charging from max range eats 2–3 arrows before it reaches you. Creeps move at 30–34 px/s, the archer fires every 1.1s from 96px.
- **Creep levels:** camps get tougher the further they are from the start. The level shows next to each creep's health bar: green = lower than you, yellow = same, orange/red = higher.

## No saving

Each visit starts a fresh adventure in a new random world. **New game** (in the character page, tap twice) starts over at any time. Dying brings the hero back at the sanctuary.

## Items

Icons come from `art-source/items-sheet.png`, sliced into the `items` atlas (bows, quivers, daggers, armour, rings, amulets, belts, cloaks, potions, food, materials, quest items and misc; 113 icons).

The hero has six bag slots, like a WC3 hero. Potions stack up to 9; each piece of gear takes a slot.
- **Healing Potion:** +220 health. **Mana Potion:** +120 mana. Found by searching rocks and crystals, or as creep drops.
- **Tomes** (from chests) permanently raise a stat.

### Equipment

Nine slots: bow, quiver, helmet, armour, gloves, boots, cloak, ring, amulet. Each piece comes in six tiers matching the sheet's colour steps (Worn, Woodland, Iron, Moonsteel, Gilded, Fey) and has an item level; stats scale +40% per tier and +10% per level (`src/entities/items.ts`).

| Slot | Gives |
|---|---|
| Bow | damage |
| Quiver | damage, attack speed |
| Helmet | health, armour |
| Armour | health, armour |
| Gloves | attack speed, damage |
| Boots | move speed, health |
| Cloak | health regen, move speed |
| Ring | mana, mana regen |
| Amulet | mana, health |

Armour takes a flat amount off every hit (a hit always does at least 1). Attack speed shortens the time between arrows.

**Drops:** creeps drop gear 12% of the time, scaled to their level; alpha boars always drop something a tier up; treasure chests give a Moonsteel-or-better piece. Open the bag (portrait, bag button or C) and tap gear to wear it; tap a worn piece to take it off. Belts, daggers, food and materials are sliced but not used yet.

## The Ranger's kit

| Key | Ability | |
|---|---|---|
| Q | **Searing Arrows** | Autocast toggle. Attacks become fire arrows (the concept sheet's fire infusion) that burst into flame on hit. +12/22/32 damage for 8 mana each. |
| W | **Volley** | A cone of 5/7/9 arrows. Each one hits the first enemy in its path, so point-blank shots do huge burst damage. |
| E | **Tumble** | A short dash that stops at obstacles. Your next attack within 4s fires instantly for 150/175/200% damage. |
| R | **Rain of Arrows** (ultimate, hero level 4/8) | Mark an area with the rune circle (0.45s), then 6 waves of sky arrows: each wave drops one arrow onto every enemy inside the circle, and the damage lands with the arrow. The circle's rim is drawn exactly at the hit radius (18px), so what you see is what gets hit. The hero channels in the focus aura. Any new order cancels it. |

Abilities level up WC3-style: a skill point per hero level, and basic abilities need hero level 1/3/5.

## World generation

Every game builds a new random map (`src/world/map.ts`, seeded, so a seed always gives the same map), in a Night Elf style.

**Biomes come from noise layers:**
- **Woods:** green oak woods, pine stands, autumn groves, and fey woods of violet trees. One or two giant violet trees stand as landmarks.
- **Rocky areas:** rune stones and rubble, with blue and purple crystal clusters.
- **Ponds:** muddy banks and reeds.
- **Meadows:** wildflowers, thicker near the trees.

**The elven sanctuary at the start** is a paved plaza with:
- The shrine and a **moonwell**: standing in its glowing circle restores health and mana.
- Moon banners, lamps, a statue and a crystal pillar.
- An arch gate you walk under, a market stall and a cart.

Roads leave from the sanctuary's edge to every camp.

**Scale:** the hero is 22px tall (1.4 tiles) and everything is sized against it, matching the reference mockup:
- Big trees ~3 heroes, young trees and bushes ~1.2, the giant violet tree 3.5.
- Rune stones ~2, boulders ~1.2, searchable rocks ~1.
- Shrine ~5, moonwell ~2.6, statues ~3, gates ~3.
- Market stalls ~1.5 heroes tall, lamp posts and banners ~1.7–2, barrels and crates ~0.8.
- Ponds are small pools (10–40 tiles); roads are 2–3 tiles (~3 heroes) wide.

The slicer cuts each prop at its own scale (`ELVEN_SCALES` in `tools/slice_sheet.py`); the default zoom is ~15% closer than before so the hero fills more of a phone screen.

**Props** (`src/world/props.ts`) have footprints:
- Trees block arrows, but only their trunk tile; the canopy overhangs.
- Stones, ruins and structures block their visible width (arches can be walked under).
- Rocks and crystals can be searched for potions.

Forests block every tile but only draw a tree on every other one, since the canopies are about three tiles wide; the forest edge always gets a tree.

**Camps are dressed to match their occupants.** Skeletons live among ruins and rune stones, boars among logs and mushrooms, and treasure camps have a ruined arch, altars, pedestals and crystals.

**Ground is generated at load** (`src/art/ground.ts`). Grass, dirt and water use colours sampled from the sheet with noise and small marks, so there are no tile seams. The plaza uses the sheet's stone tiles. Rain of Arrows and level-ups use the sheet's glowing glyphs.

## Creeps

The map is 96×96 tiles with about 24 camps scattered across it, all joined by dirt roads.
- **Group sizes vary:** loners (a level higher, so they still matter), pairs, trios, and packs of 4–5. Groups can mix skeletons and boars; boars get more common further out, and big packs may be led by an alpha boar.
- **Levels:** camps get tougher with distance from the start.
- **Behaviour:** camps aggro together, leash home (regenerating) if you pull them too far, and respawn 45s after being cleared, as long as you're not standing in them.
- **Treasure camps** are rare (about 1 in 10, at least 2 per map). Three elite guards, a level higher, stand around a glinting chest. Once the guards are dead, tap the chest to open it: you get a tome, two potions and bonus XP.

Tomes work like WC3 tomes: they're read on pickup and permanently boost a stat.
- Tome of Vitality: +60 health
- Tome of Insight: +40 mana
- Tome of Power: +4 damage
- Tome of Swiftness: +3 move speed

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
  world/map.ts            seeded map generation (biomes, props, decor, camps, roads)
  world/props.ts          elven prop catalogue (footprints, blocking kind, groups)
  art/ground.ts           bakes ground chunks (generated grass/dirt/water, stone plaza, shadows, decor)
  world/pathfinding.ts    A*, line of walk, path smoothing
  art/                    terrain/props/icons drawn in code, atlas animation setup
  assets/sprites/         unit atlases generated from art-source/ by tools/slice_sheet.py
  ui/hud.ts               DOM HUD: hero frame, minimap, command card, potion slots, tooltips
  ui/characterPage.ts     stats + six-slot inventory
  entities/balance.ts     combat tuning (damage, creep hp per level, xp, drops)
  entities/items.ts       items and the inventory
```
