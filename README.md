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
| Attack-move | A button, bottom-left (left thumb) | A |
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
- **Levelling:** the cap is level 20. Going up a level takes about 9 same-level kills at first and over 35 near the cap (`src/entities/xp.ts`); quests add XP on top.
- **Creep levels:** camps get tougher the further they are from the start (up to level 12 in the overworld; dungeons go deeper). The level shows next to each creep's health bar: green = lower than you, yellow = same, orange/red = higher.

## No saving

Each visit starts a fresh adventure in a new random world. **New game** (in the character page's ⋯ menu, tap twice) starts over at any time. Dying brings the hero back at the sanctuary.

## Items

Icons come from `art-source/items-sheet.png`, sliced into the `items` atlas (bows, quivers, daggers, armour, rings, amulets, belts, cloaks, potions, food, materials, quest items and misc; 113 icons).

The hero has a 24-slot backpack for gear; each piece takes a slot. Potions don't use the bag: they sit on the belt behind the 1 / 2 buttons, up to 9 of each.
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

**Drops and rarity:** creeps drop gear 7% of the time (alpha boars always), potions 12% and gold 60%. Quality follows WoW-style odds: Common 60%, Uncommon 26%, Fine 9%, Rare 3.5%, Epic 1.2%, Legendary 0.3%; higher-level creeps tilt the odds a little (+4% per level per quality step), alpha boars and treasure chests a lot (chests are Fine or better). Every piece **requires a level** (its item level − 1), so loot from a deep dungeon has to wait, and has a **sell price** for the village vendor. Open the character page (portrait, bag button or C). It's a pixel-art take on the World of Warcraft character frame: gold bevelled frames, inset stone slots and buttons drawn as pixel art at boot (`src/ui/pixelFrame.ts`), the bundled Pixelify Sans font, the round portrait with the level badge, **Attributes** on the left, the nine **Equipped** slots on the right (empty ones show a faint silhouette), and a **24-slot Backpack** below. Gear moves by **drag and drop**: drag a piece from the backpack onto Equipped (anywhere on it; it goes to its own slot) to wear it, drag a worn piece into the backpack to take it off (onto a piece of the same kind to swap them), and drag between backpack slots to rearrange. Valid places glow while you drag. The backpack holds gear only: **potions go on the belt** (the 1 / 2 buttons), up to 9 of each. Tap any item for its WoW-style tooltip card: name and quality in the rarity colour (Common, Uncommon, Fine, Rare, Epic, Legendary), its bonuses, how it compares with what you wear (green better, red worse), and **Wear** / **Take off**. With a mouse, hovering previews the card. The card sits beside the panel when there's room and at the bottom on portrait phones. Belts, daggers, food and materials are sliced but not used yet.

## The Ranger's kit

| Key | Ability | |
|---|---|---|
| Q | **Searing Arrows** | Autocast toggle. Attacks become fire arrows (the concept sheet's fire infusion) that burst into flame on hit. +12/22/32 damage for 8 mana each. |
| W | **Volley** | A cone of 5/7/9 arrows. Each one hits the first enemy in its path, so point-blank shots do huge burst damage. |
| E | **Tumble** | A short dash that stops at obstacles. Your next attack within 4s fires instantly for 150/175/200% damage. |
| R | **Rain of Arrows** (ultimate, hero level 6/12) | Mark a wide area with the rune circle (0.35s), then 6 quick waves of sky arrows (one every 0.3s, each falling in 0.24s): each wave drops one arrow onto every enemy inside the circle, and the damage lands with the arrow. The circle's rim is drawn exactly at the hit radius (40px, 2.5 tiles), so what you see is what gets hit. The hero channels in the focus aura. Any new order cancels it. |

Abilities level up WC3-style: a skill point per hero level; basic abilities open their ranks at hero level 1/4/7, the ultimate at 6/12.

## Talents

Buffs come from a WoW-style talent tree, **Marksmanship** (`src/entities/talents.ts`): ten talents in four tiers. You get a talent point **every second level** (levels 2, 4, … 20: ten points against 21 ranks, so you choose). A tier opens once enough points are spent in the tree (0 / 2 / 4 / 6), and Deadeye also needs Trueshot Aura (the gold arrow). Open it from the character page's **Talents** tab (or N); unspent points show as a gold badge on the tab and the bag button. Tap a talent for its card (current and next rank, what's missing) and **Learn**; **Reset** refunds every point.

| Tier | Talent | Ranks | Effect per rank |
|---|---|---|---|
| 1 | Sharpshooter | 3 | +2 attack damage |
| 1 | Hardiness | 3 | +40 maximum health |
| 1 | Swift Feet | 2 | +3 move speed |
| 2 | Quick Draw | 3 | +6% attack speed |
| 2 | Long Shot | 2 | +1 tile attack range |
| 2 | Meditation | 2 | +0.5 mana regeneration |
| 3 | Searing Mastery | 2 | Searing Arrows +6 fire damage, 2 less mana |
| 3 | **Trueshot Aura** (aura) | 1 | +15% damage on every attack; the golden precision aura stays around the hero |
| 3 | Rain Storm | 2 | Rain of Arrows +1 wave |
| 4 | Deadeye | 1 | 15% chance for double damage (big gold numbers); needs Trueshot Aura |

The test mode (every ability maxed, all talent points from the start) is gone: abilities and talents are earned.

## Dungeons

The overworld (128 × 128 tiles) has **four dungeon entrances**: stone gates far from the start (with rocks behind them and a road to the door), each labelled with its name and creep level. Walk into a gate's doorway to go down. Every floor is generated (`src/world/dungeon.ts`), fixed by the world seed so each entrance always has the same floors:

1. **Rooms:** up to 11 non-overlapping rooms: plain halls, pillared halls (two rows of pillars) and caves (noisy ellipses).
2. **Corridors:** a minimum spanning tree over the room centres plus a few extra links for loops; L-shaped and two tiles wide.
3. **Start and boss:** you arrive in the room nearest a random corner, by the **exit gate** back to the overworld. The room farthest from it on foot is the **boss room**: an elite pack (often led by an alpha boar) around a chest, and the purple **rune portal** that leads a floor deeper (+1 creep level each floor).
4. **The rest:** a skeleton-heavy pack in every other room (tougher in the far half), searchable crystals (potions), torches in the corners, ruins and supplies against the walls.

The look is old top-down Zelda: dark stone floor, walls as a dark mass with a brick face where floor lies below them (3/4 view), a lit ledge, stone rims and shadow at the foot of each wall. It's **dark**: a pool of light around the hero, warm flickering torches, blue crystals, and the portal's glow. The minimap shows the floor plan, and doorways as purple dots.

Travelling restarts the scene with the new map and carries the hero over (level, XP, abilities, talents, gear, backpack, potions, health and mana). Chests opened and rocks searched stay looted for the rest of the run, on every map. Dying in a dungeon brings you back in its start room. **Dungeon monsters don't respawn**: a cleared room stays cleared for the rest of the run (overworld camps still come back after 45s away).

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
