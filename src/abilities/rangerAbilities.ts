import { TILE } from '../world/map';
import { hasLineOfWalk } from '../world/pathfinding';
import type { Hero } from '../entities/Hero';
import { Ability, Channel, Preview } from './Ability';

/** Q — autocast toggle: every attack becomes a flaming arrow for a bit of mana. */
export class SearingArrows extends Ability {
  readonly id = 'searing';
  readonly name = 'Searing Arrows';
  readonly hotkey = 'Q';
  readonly icon = 'searing';
  readonly maxLevel = 3;
  readonly targeting = 'toggle' as const;
  autocast = false;

  manaCost(): number {
    return 8;
  }
  cooldown(): number {
    return 0;
  }
  castRange(): number {
    return 0;
  }
  bonus(level = this.level): number {
    return [0, 12, 22, 32][level];
  }
  describe(l: number): string {
    return `Toggle. Attacks burn for +${this.bonus(Math.max(1, l))} fire damage. Costs ${this.manaCost()} mana per arrow.`;
  }
  cast(): void {
    this.autocast = !this.autocast;
  }
}

/** W — fan of arrows toward a point. Close range = big burst. */
export class Volley extends Ability {
  readonly id = 'volley';
  readonly name = 'Volley';
  readonly hotkey = 'W';
  readonly icon = 'volley';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly castPoint = 0.2;
  readonly spread = Math.PI / 3.6;
  readonly preview: Preview = { shape: 'cone', spread: Math.PI / 3.6, length: 8 * TILE };

  arrows(level = this.level): number {
    return [0, 5, 7, 9][level];
  }
  arrowDamage(level = this.level): number {
    return [0, 30, 40, 50][level];
  }
  manaCost(): number {
    return [0, 55, 65, 75][this.level];
  }
  cooldown(): number {
    return 8;
  }
  castRange(): number {
    return 8 * TILE;
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Fires ${this.arrows(L)} arrows in a cone, each dealing ${this.arrowDamage(L)} damage to the first enemy hit.`;
  }
  cast(hero: Hero, x: number, y: number): void {
    const base = Math.atan2(y - hero.y, x - hero.x);
    const n = this.arrows();
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : -this.spread / 2 + (this.spread * i) / (n - 1));
      hero.world.fireVolleyArrow(hero, a, this.castRange(), this.arrowDamage());
    }
  }
}

/** E — quick dash; the next attack within a few seconds hits much harder and fires instantly. */
export class Tumble extends Ability {
  readonly id = 'tumble';
  readonly name = 'Tumble';
  readonly hotkey = 'E';
  readonly icon = 'tumble';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly clampToRange = true;
  readonly castPoint = 0;
  readonly preview: Preview = { shape: 'line', width: 10 };

  manaCost(): number {
    return 35;
  }
  cooldown(): number {
    return [0, 9, 7.5, 6][this.level];
  }
  castRange(): number {
    return 4.5 * TILE;
  }
  empowerMult(level = this.level): number {
    return [1, 1.5, 1.75, 2][level];
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Dash a short distance. Your next attack within 4s deals ${Math.round(this.empowerMult(L) * 100)}% damage.`;
  }
  cast(hero: Hero, x: number, y: number): void {
    // Dash along the line until something blocks the way.
    const from = { x: hero.x / TILE, y: hero.y / TILE };
    const dx = x - hero.x;
    const dy = y - hero.y;
    const len = Math.hypot(dx, dy) || 1;
    let reach = 0;
    const r = hero.stats.radius / TILE;
    for (let d = 2; d <= len; d += 2) {
      const to = { x: (hero.x + (dx / len) * d) / TILE, y: (hero.y + (dy / len) * d) / TILE };
      if (!hasLineOfWalk(hero.world.map, from, to, r)) break;
      reach = d;
    }
    hero.dashTo(hero.x + (dx / len) * reach, hero.y + (dy / len) * reach, 0.22);
    hero.empower(this.empowerMult(), 4);
  }
}

/** R — ultimate: channel a storm of arrows on an area. */
export class RainOfArrows extends Ability {
  readonly id = 'rain';
  readonly name = 'Rain of Arrows';
  readonly hotkey = 'R';
  readonly icon = 'rain';
  readonly maxLevel = 2;
  readonly targeting = 'point' as const;
  readonly castPoint = 0.25;
  readonly radius = 3 * TILE;
  readonly preview: Preview = { shape: 'circle', radius: 3 * TILE };

  requiredHeroLevel(nextLevel: number): number {
    return nextLevel * 4;
  }
  manaCost(): number {
    return [0, 125, 175][this.level];
  }
  cooldown(): number {
    return [0, 40, 30][this.level];
  }
  castRange(): number {
    return 9 * TILE;
  }
  waveDamage(level = this.level): number {
    return [0, 35, 55][level];
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Channel for 3s: 6 waves of arrows each deal ${this.waveDamage(L)} damage in an area. Moving cancels it.`;
  }
  cast(hero: Hero, x: number, y: number): Channel {
    let t = 0;
    let waves = 0;
    const dmg = this.waveDamage();
    const world = hero.world;
    world.skyMark(x, y, this.radius, 3.2);
    return {
      duration: 3,
      update: (dt) => {
        t += dt;
        // Each wave: a volley of sky arrows lands and bursts, then the damage tick.
        while (waves < 6 && t >= waves * 0.5 + 0.35) {
          waves++;
          world.skyWave(x, y, this.radius, 4 + Math.min(waves, 3));
          for (const u of world.enemiesInRadius(hero, x, y, this.radius)) world.damage(u, dmg, hero, { color: '#9dffb0' });
        }
      },
    };
  }
}

export function rangerKit(): Ability[] {
  return [new SearingArrows(), new Volley(), new Tumble(), new RainOfArrows()];
}
