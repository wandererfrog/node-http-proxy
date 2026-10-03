import type { Ability } from '../abilities/Ability';
import { knightKit } from '../abilities/knightAbilities';
import { mageKit } from '../abilities/mageAbilities';
import { rangerKit } from '../abilities/rangerAbilities';
import { TILE } from '../world/map';
import type { ClassId } from './talents';

export type { ClassId };

/**
 * The three heroes you can play. Each has its own sprite sheet, base stats, attack, four abilities
 * (Q W E and the R ultimate) and talent tree (see talents.ts).
 */
export interface ClassDef {
  id: ClassId;
  /** Class name, shown in the HUD and used by villagers ("Ranger", "Mage", "Knight"). */
  name: string;
  /** The hero's own name. */
  hero: string;
  /** Unit atlas. */
  texture: string;
  /** One-line role for the class pick. */
  role: string;
  blurb: string;
  maxHp: number;
  maxMana: number;
  hpPerLevel: number;
  manaPerLevel: number;
  hpRegen: number;
  manaRegen: number;
  speed: number;
  /** px, edge to edge */
  attackRange: number;
  attackCooldown: number;
  damagePoint: number;
  backswing: number;
  /** Base damage multiplier against the shared hero damage curve. */
  damageMult: number;
  armor: number;
  /** How the basic attack looks and lands. */
  attack: 'arrow' | 'arcane' | 'melee';
  kit(): Ability[];
  /** What the weapon and off-hand slots are called for this class. */
  weapon: string;
  offhand: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    hero: 'Sylva',
    texture: 'archer',
    role: 'Ranged · agile',
    blurb: 'An elven archer of the woods. Strikes from afar, kites her foes and rains arrows on whole packs.',
    maxHp: 420,
    maxMana: 220,
    hpPerLevel: 45,
    manaPerLevel: 18,
    hpRegen: 1.2,
    manaRegen: 1.4,
    speed: 46,
    attackRange: 6 * TILE,
    attackCooldown: 1.1,
    damagePoint: 0.25,
    backswing: 0.35,
    damageMult: 1,
    armor: 0,
    attack: 'arrow',
    kit: rangerKit,
    weapon: 'Bow',
    offhand: 'Quiver',
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    hero: 'Elowen',
    texture: 'mage',
    role: 'Ranged · spells',
    blurb: 'A scholar of the arcane. Frail, but freezes packs in place, blinks out of danger and hides behind a shield of force.',
    maxHp: 340,
    maxMana: 320,
    hpPerLevel: 36,
    manaPerLevel: 26,
    hpRegen: 1,
    manaRegen: 2.2,
    speed: 44,
    attackRange: 5.5 * TILE,
    attackCooldown: 1.25,
    damagePoint: 0.3,
    backswing: 0.3,
    damageMult: 1.1,
    armor: 0,
    attack: 'arcane',
    kit: mageKit,
    weapon: 'Staff',
    offhand: 'Tome',
  },
  knight: {
    id: 'knight',
    name: 'Knight',
    hero: 'Roderic',
    texture: 'knight',
    role: 'Melee · tough',
    blurb: 'A shield of the realm in steel and blue. Wades into the pack, stuns, spins and takes the blows for you.',
    maxHp: 580,
    maxMana: 160,
    hpPerLevel: 62,
    manaPerLevel: 12,
    hpRegen: 2,
    manaRegen: 1.1,
    speed: 44,
    attackRange: 10,
    attackCooldown: 1.0,
    damagePoint: 0.22,
    backswing: 0.3,
    damageMult: 1.15,
    armor: 3,
    attack: 'melee',
    kit: knightKit,
    weapon: 'Sword',
    offhand: 'Shield',
  },
};

export const CLASS_IDS: ClassId[] = ['ranger', 'mage', 'knight'];
