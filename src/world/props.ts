/**
 * Catalogue of environment props from art-source/elven-sheet.png (frames in the 'elven' atlas).
 *
 * - kind 'tree'  blocks movement and arrows (trees, bushes, stumps).
 * - kind 'block' blocks movement only (stones, ruins, logs, elven structures, village props).
 * - kind 'rock'  blocks movement and can be searched for potions (rocks and crystals).
 * - w/h is the footprint in tiles, anchored at the bottom-left tile and growing right and up.
 *   Trees block only their trunk tile; the canopy overhangs. Wide stones and structures block
 *   their visible width. `solid` lists which footprint columns block, for props you can walk
 *   under (arches).
 *
 * Decor (flowers, reeds) never blocks and is baked into the ground.
 */

export const ENV_ATLAS = 'elven';

export type PropKind = 'tree' | 'block' | 'rock';

export interface PropDef {
  kind: PropKind;
  w: number;
  h: number;
  solid?: number[];
}

const tree = (w = 1, h = 1): PropDef => ({ kind: 'tree', w, h });
const block = (w = 1, h = 1): PropDef => ({ kind: 'block', w, h });
const rock = (w = 1): PropDef => ({ kind: 'rock', w, h: 1 });

export const PROPS: Record<string, PropDef> = {
  oak_0: tree(), oak_1: tree(), oak_2: tree(), oak_3: tree(), autumn_0: tree(),
  pine_0: tree(), pine_1: tree(), violet_0: tree(), violet_1: tree(), violet_2: tree(),
  violet_giant: tree(5, 2),
  bush_0: tree(), bush_1: tree(), bush_2: tree(), bush_3: tree(), bush_4: tree(), bush_5: tree(), bush_6: tree(),
  bush_flower: tree(), bush_violet: tree(), bush_autumn_0: tree(), bush_autumn_1: tree(),
  stump_0: tree(), mushrooms: block(2), stump_moss: block(3), log_0: block(3), log_1: block(3),
  runestone_0: block(2), runestone_1: block(2), runestone_2: block(2), runestone_3: block(2), rune_slab: block(),
  rock_2: block(2), rubble: block(3),
  rock_0: rock(2), rock_1: rock(2), crystal_0: rock(2), crystal_1: rock(), crystal_2: rock(),
  ruin_pillar: block(), ruin_block: block(), ruin_wall: block(2), ruin_arch: { kind: 'block', w: 3, h: 1, solid: [0, 2] },
  elf_pillar_0: block(), elf_pillar_1: block(),
  shrine: block(7, 2), statue: block(2), moonwell: block(4, 2), arch_gate: { kind: 'block', w: 6, h: 1, solid: [0, 5] },
  spire_lamp: block(), crystal_pillar: block(), banner_pole: block(), banner_pole_1: block(), banner_small: block(),
  lamp_post: block(), lantern_post: block(), pedestal_0: block(), pedestal_1: block(), pedestal_orb: block(),
  altar: block(2), bench: block(2), market_stall: block(3), cart: block(3), well: block(2),
  signpost: block(), crates: block(), crate: block(), barrel: block(), sack: block(), sacks: block(2), pot: block(),
  fence_0: block(2), fence_1: block(2), fence_2: block(2), fence_3: block(2),
};

export const GROUPS = {
  oak: ['oak_0', 'oak_1', 'oak_2', 'oak_3'],
  autumn: ['autumn_0', 'bush_autumn_0', 'bush_autumn_1', 'oak_1'],
  pine: ['pine_0', 'pine_1', 'pine_0', 'oak_3'],
  violet: ['violet_0', 'violet_1', 'violet_2', 'bush_violet'],
  bush: ['bush_0', 'bush_1', 'bush_2', 'bush_3', 'bush_4', 'bush_5', 'bush_6', 'bush_flower'],
  stump: ['stump_0', 'mushrooms', 'stump_moss'],
  wood: ['log_0', 'log_1', 'stump_moss'],
  stone: ['runestone_0', 'runestone_1', 'runestone_2', 'rock_2', 'rubble'],
  /** searchable for potions */
  rock: ['rock_0', 'rock_1', 'crystal_0', 'crystal_1', 'crystal_2'],
  crystal: ['crystal_0', 'crystal_1', 'crystal_2'],
  ruins: ['ruin_pillar', 'ruin_block', 'ruin_wall', 'ruin_arch', 'elf_pillar_0', 'elf_pillar_1', 'runestone_3', 'rune_slab'],
  shrineProps: ['pedestal_0', 'pedestal_1', 'pedestal_orb', 'altar', 'crystal_pillar', 'banner_small'],
  supplies: ['crates', 'crate', 'barrel', 'sack', 'sacks', 'pot'],
  // decor
  flower: Array.from({ length: 13 }, (_, i) => `flower_${i}`),
  reeds: ['reeds'],
} as const;

export const GRASS_FRAMES = ['ground_grass_0', 'ground_grass_1', 'ground_grass_0', 'ground_grass_1', 'ground_grass_2'];

/** Tiles a prop's footprint blocks, as [dx, dy-up] offsets from its anchor. */
export function footprint(def: PropDef): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) if (!def.solid || def.solid.includes(dx)) out.push([dx, dy]);
  return out;
}
