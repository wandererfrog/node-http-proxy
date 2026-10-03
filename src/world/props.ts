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
  /** Atlas holding the frame: the elven sheet unless it's a village piece (the 'town' atlas). */
  atlas?: string;
}

/** Village buildings and props, from art-source/town-sheet.png and shops-sheet.png. */
export const TOWN_ATLAS = 'town';

const tree = (w = 1, h = 1): PropDef => ({ kind: 'tree', w, h });
const block = (w = 1, h = 1): PropDef => ({ kind: 'block', w, h });
const rock = (w = 1): PropDef => ({ kind: 'rock', w, h: 1 });
/** A village piece. Buildings block their base rows; the roof is drawn over the tiles behind. */
const town = (w = 1, h = 1, solid?: number[]): PropDef => ({ kind: 'block', w, h, atlas: TOWN_ATLAS, ...(solid ? { solid } : {}) });

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
  spire_lamp: block(), crystal_pillar: block(), banner_pole: block(), banner_pole_1: block(), banner_small_0: block(), banner_small_1: block(),
  lamp_post_0: block(), lamp_post_1: block(), lamp_small: block(), lantern_post: block(), pedestal_0: block(),
  altar: block(2), bench_0: block(), bench_1: block(2), market_stall: block(2), market_stall_1: block(2),
  signpost: block(), crates: block(), crate_0: block(), crate_1: block(), crate_small: block(),
  barrel_0: block(), barrel_1: block(), barrel_2: block(), sack: block(), pot_0: block(), pot_1: block(),
  planter_0: block(), planter_1: block(), chest_closed: block(),
  fence_0: block(), fence_1: block(2), fence_2: block(2),
  // village (town atlas): buildings
  cathedral: town(8, 4), house_blue: town(4, 4), house_red: town(5, 4), house_shop: town(3, 4), house_narrow: town(2, 4),
  watchtower: town(1, 2),
  // village props
  stone_arch: town(2, 1, [0, 1]), pillar_vines: town(), column: town(), fence_rail: town(2), fence_rail_1: town(2), wall_planters: town(2),
  barrels: town(), barrel_big: town(), sack_town: town(), banner_town: town(), banner_post: town(), bench_town: town(), bollard: town(),
  lamp_double: town(), lamp_iron: town(), lamp_ornate: town(), lamp_tall: town(), lamp_small_town: town(), crystal_lantern: town(),
  planter_big: town(), planter_round: town(), crate_town: town(), noticeboard: town(), pump: town(), flowerbox: town(),
  potted_plant: town(), water_barrel: town(), buckets: town(), vase_flowers: town(),
  stall_red: town(2), stall_red_1: town(2), stall_blue: town(2), stall_blue_1: town(), stall_cream: town(), stall_flowers: town(),
  tree_town_0: { kind: 'tree', w: 1, h: 1, atlas: TOWN_ATLAS }, tree_town_1: { kind: 'tree', w: 1, h: 1, atlas: TOWN_ATLAS },
  tree_blossom: { kind: 'tree', w: 1, h: 1, atlas: TOWN_ATLAS },
  bush_town_0: town(), bush_town_1: town(), flowerbed_0: town(), flowerbed_1: town(), flowerbed_2: town(),
  angel_statue: town(2), obelisk: town(), fountain: town(2), crystal_stand: town(),
  // shops: the smithy, the apothecary, the jeweller's and the enchanter's wares
  anvil: town(), forge: town(2), weapon_rack: town(2), sword_rack: town(), shield_stand: town(), workbench_smith: town(2), grindstone: town(),
  quench_barrel: town(), potion_shelf: town(2), potion_table: town(2), herb_rack: town(2), herb_basket: town(), herb_basket_1: town(),
  potion_bench: town(3), gem_crystals: town(), scales: town(), gem_table: town(2), scry_orb: town(), rune_pillar: town(), lectern: town(2),
  enchant_table: town(2), moon_banner: town(), workbench: town(2), water_wheel: town(2),
};

/** Atlas that holds a prop's frame. */
export const propAtlas = (key: string): string => PROPS[key].atlas ?? ENV_ATLAS;

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
