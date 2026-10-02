/**
 * Catalogue of environment props from art-source/environment-sheet.png (frames in the 'env' atlas).
 *
 * - kind 'tree'  blocks movement and arrows (trees, bushes, stumps).
 * - kind 'block' blocks movement only (boulders, ruins, logs, village props).
 * - kind 'rock'  blocks movement and can be searched for potions.
 * - w/h is the footprint in tiles, anchored at the bottom-left tile and growing right and up.
 *
 * Decor (tufts, flowers, pebbles, lily pads...) never blocks and is baked into the ground.
 */

export type PropKind = 'tree' | 'block' | 'rock';

export interface PropDef {
  kind: PropKind;
  w: number;
  h: number;
}

const tree = (w = 1, h = 1): PropDef => ({ kind: 'tree', w, h });
const block = (w = 1, h = 1): PropDef => ({ kind: 'block', w, h });

export const PROPS: Record<string, PropDef> = {
  oak_big_0: tree(), oak_big_1: tree(), oak_big_2: tree(), oak_big_3: tree(),
  oak_small_0: tree(), oak_small_1: tree(), oak_small_2: tree(), oak_small_3: tree(), oak_small_4: tree(),
  pine_0: tree(), pine_1: tree(), pine_2: tree(), pine_3: tree(), pine_4: tree(),
  pine_small_0: tree(), pine_small_1: tree(),
  dead_0: tree(), dead_1: tree(), dead_2: tree(),
  bush_0: tree(), bush_1: tree(), bush_2: tree(), bush_3: tree(), bush_4: tree(),
  bush_5: tree(), bush_6: tree(), bush_7: tree(), bush_8: tree(), bush_9: tree(),
  stump_0: tree(), stump_1: tree(), stump_2: tree(), stump_3: tree(), stump_big: block(2, 1),
  log_0: block(2, 1), log_1: block(2, 1),
  boulder_0: block(2, 2), boulder_1: block(2, 1), boulder_2: block(2, 1),
  rock_0: { kind: 'rock', w: 1, h: 1 }, rock_1: { kind: 'rock', w: 1, h: 1 },
  rock_2: { kind: 'rock', w: 1, h: 1 }, rock_3: { kind: 'rock', w: 1, h: 1 },
  tomb: block(), pillar_0: block(), pillar_1: block(), pillar_2: block(),
  wall_0: block(), wall_1: block(), wall_2: block(), wall_3: block(), arch: block(2, 1),
  signpost: block(), lamppost: block(), crate: block(), barrel: block(), sack: block(),
  cart: block(2, 1), firewood: block(), fence_0: block(2, 1), fence_1: block(),
};

export const GROUPS = {
  oakBig: ['oak_big_0', 'oak_big_1', 'oak_big_2', 'oak_big_3'],
  oakSmall: ['oak_small_0', 'oak_small_1', 'oak_small_2', 'oak_small_3', 'oak_small_4'],
  pine: ['pine_0', 'pine_1', 'pine_2', 'pine_3', 'pine_4'],
  pineSmall: ['pine_small_0', 'pine_small_1'],
  dead: ['dead_0', 'dead_1', 'dead_2'],
  bush: ['bush_0', 'bush_1', 'bush_2', 'bush_3', 'bush_4', 'bush_5', 'bush_6', 'bush_7', 'bush_8', 'bush_9'],
  stump: ['stump_0', 'stump_1', 'stump_2', 'stump_3'],
  wood: ['log_0', 'log_1', 'stump_big'],
  boulder: ['boulder_0', 'boulder_1', 'boulder_2'],
  rock: ['rock_0', 'rock_1', 'rock_2', 'rock_3'],
  ruins: ['tomb', 'pillar_0', 'pillar_1', 'pillar_2', 'wall_0', 'wall_1', 'wall_2', 'wall_3'],
  supplies: ['crate', 'barrel', 'sack'],
  // decor
  tuft: ['tuft_0', 'tuft_1', 'tuft_2', 'tuft_3', 'tuft_4', 'tuft_5', 'tuft_6', 'tuft_7'],
  flower: ['flower_0', 'flower_1', 'flower_2', 'flower_3', 'flower_4'],
  clover: ['clover_0', 'clover_1'],
  pebble: ['pebble_0', 'pebble_1', 'pebble_2', 'pebble_3', 'pebble_4', 'pebble_5'],
  mushroom: ['mushroom_0', 'mushroom_1', 'mushroom_2'],
  litter: ['leaves', 'twigs', 'branch'],
  lily: ['lily_0', 'lily_1', 'lily_2'],
  reeds: ['reeds_0', 'reeds_1', 'reeds_2'],
} as const;

export const GRASS_FRAMES = Array.from({ length: 8 }, (_, i) => `ground_grass_${i}`);
