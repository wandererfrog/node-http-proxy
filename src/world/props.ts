/**
 * Catalogue of environment props from art-source/elven-sheet-2.png (frames in the 'elven' atlas).
 *
 * - kind 'tree'  blocks movement and arrows (trees, bushes, stumps).
 * - kind 'block' blocks movement only (stones, ruins, logs, elven structures, village props).
 * - kind 'rock'  blocks movement and can be searched for potions (rocks and crystals).
 * - w/h is the footprint in tiles, anchored at the bottom-left tile and growing right and up.
 *   Trees block only their trunk tile; the canopy overhangs. Wide stones and structures block
 *   their visible width. `solid` lists which footprint columns block, for props you can walk
 *   under (arches and gates).
 *
 * Decor (flower patches, reeds, grass) never blocks and is baked into the ground.
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
  // trees (trunk-only footprints)
  oak_0: tree(), oak_1: tree(), oak_2: tree(), oak_3: tree(), oak_4: tree(), oak_5: tree(), blossom: tree(),
  autumn_0: tree(), autumn_1: tree(), pine_0: tree(), pine_1: tree(), pine_2: tree(), pine_3: tree(),
  violet_0: tree(), violet_1: tree(), violet_giant: tree(6, 2),
  bush_0: tree(), bush_1: tree(), bush_2: tree(), bush_3: tree(), bush_flower_0: tree(2), bush_flower_1: tree(), bush_autumn: tree(),
  stump_0: tree(2), mushrooms: block(2),
  // wood and stone
  log_0: block(3), log_1: block(3),
  runestone_0: block(2), runestone_1: block(2), runestone_2: block(2), rock_2: block(2), rock_3: block(2), rock_4: block(3),
  rubble: block(2), ruin_block: block(2),
  rock_0: rock(2), rock_1: rock(), crystal_0: rock(), crystal_1: rock(2), crystal_2: rock(2), crystal_3: rock(),
  // ruins
  ruin_pillar: block(2), ruin_wall: block(2), ruin_arch: { kind: 'block', w: 3, h: 1, solid: [0, 2] }, elf_pillar_0: block(2),
  rune_slab: block(), stone_gate: { kind: 'block', w: 4, h: 1, solid: [0, 3] },
  // elven structures
  shrine: block(8, 2), statue: block(2), statue_1: block(3), moonwell: block(3, 2),
  arch_gate: { kind: 'block', w: 7, h: 1, solid: [0, 6] },
  spire_lamp: block(2), crystal_pillar: block(), banner_pole: block(2), banner_pole_1: block(2), banner_small_0: block(), banner_small_1: block(),
  lamp_post_0: block(), lamp_post_1: block(2), lamp_small: block(), lantern_post: block(2), pedestal_0: block(),
  altar: block(3), bench_0: block(), bench_1: block(3), market_stall: block(4), market_stall_1: block(4),
  signpost: block(2), crates: block(), crate_0: block(), crate_1: block(), crate_small: block(),
  barrel_0: block(), barrel_1: block(), barrel_2: block(), sack: block(), pot_0: block(), pot_1: block(),
  planter_0: block(), planter_1: block(), chest_closed: block(2),
  fence_0: block(2), fence_1: block(3), fence_2: block(3),
};

export const GROUPS = {
  oak: ['oak_0', 'oak_1', 'oak_2', 'oak_3', 'oak_4', 'oak_5', 'blossom'],
  autumn: ['autumn_0', 'autumn_1', 'bush_autumn', 'oak_3'],
  pine: ['pine_0', 'pine_1', 'pine_2', 'pine_3'],
  violet: ['violet_0', 'violet_1', 'bush_2'],
  bush: ['bush_0', 'bush_1', 'bush_2', 'bush_3', 'bush_flower_0', 'bush_flower_1'],
  stump: ['stump_0', 'mushrooms'],
  wood: ['log_0', 'log_1', 'stump_0'],
  stone: ['runestone_0', 'runestone_1', 'runestone_2', 'rock_2', 'rock_3', 'rock_4', 'rubble'],
  /** searchable for potions */
  rock: ['rock_0', 'rock_1', 'crystal_0', 'crystal_1', 'crystal_2', 'crystal_3'],
  crystal: ['crystal_0', 'crystal_1', 'crystal_2', 'crystal_3'],
  ruins: ['ruin_pillar', 'ruin_block', 'ruin_wall', 'ruin_arch', 'elf_pillar_0', 'rune_slab', 'stone_gate'],
  shrineProps: ['pedestal_0', 'altar', 'crystal_pillar', 'banner_small_0', 'banner_small_1', 'lamp_small'],
  supplies: ['crates', 'crate_0', 'crate_1', 'barrel_0', 'barrel_1', 'barrel_2', 'sack', 'pot_0', 'pot_1'],
  // decor
  flower: ['flowers_0', 'flowers_1', 'flowers_2', 'flowers_3', 'flowers_4', 'plant_0', 'grass_0', ...Array.from({ length: 17 }, (_, i) => `flower_${i}`)],
  reeds: ['reeds'],
} as const;

export const GRASS_FRAMES = ['ground_grass_0', 'ground_grass_1', 'ground_grass_2'];

/** Tiles a prop's footprint blocks, as [dx, dy-up] offsets from its anchor. */
export function footprint(def: PropDef): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) if (!def.solid || def.solid.includes(dx)) out.push([dx, dy]);
  return out;
}
