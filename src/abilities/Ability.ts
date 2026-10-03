import type { Hero } from '../entities/Hero';

/** point: aim at the ground; toggle: switch on/off (autocast); self: cast at once, around the hero. */
export type Targeting = 'point' | 'toggle' | 'self';

export type Preview =
  | { shape: 'circle'; radius: number }
  | { shape: 'cone'; spread: number; length: number }
  | { shape: 'line'; width: number };

/** A channelled effect (e.g. Rain of Arrows). The hero keeps channelling until it ends or gets a new order. */
export interface Channel {
  duration: number;
  update(dt: number): void;
  end?(): void;
}

export abstract class Ability {
  level = 0;
  /** seconds left on cooldown */
  cd = 0;

  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly hotkey: string;
  abstract readonly icon: string;
  abstract readonly maxLevel: number;
  abstract readonly targeting: Targeting;
  /** If true, a point beyond cast range is pulled in to max range instead of walking there (like Blink). */
  readonly clampToRange: boolean = false;
  readonly castPoint: number = 0.15;
  readonly preview: Preview | null = null;

  abstract manaCost(): number;
  abstract cooldown(): number;
  /** px */
  abstract castRange(): number;
  abstract describe(level: number): string;

  /** Normal abilities open their ranks at hero level 1/4/7 (the ultimate overrides this: 6/12). */
  requiredHeroLevel(nextLevel: number): number {
    return nextLevel * 3 - 2;
  }

  canLearn(hero: Hero): boolean {
    return hero.skillPoints > 0 && this.level < this.maxLevel && hero.level >= this.requiredHeroLevel(this.level + 1);
  }

  /** Reason the ability can't be cast right now, or null. */
  blocked(hero: Hero): string | null {
    if (this.level === 0) return 'Not learned yet';
    if (hero.dead) return 'Dead';
    if (this.cd > 0) return 'Not ready yet';
    if (hero.mana < this.manaCost()) return 'Not enough mana';
    return null;
  }

  tick(dt: number): void {
    this.cd = Math.max(0, this.cd - dt);
  }

  /** Perform the effect. May return a channel that the hero must maintain. */
  abstract cast(hero: Hero, x: number, y: number): Channel | void;
}
