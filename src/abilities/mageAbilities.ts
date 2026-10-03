import { TILE } from '../world/map';
import type { Hero } from '../entities/Hero';
import { TALENT_VALUES as TV } from '../entities/talents';
import { Ability, Preview } from './Ability';

/** Q — a slow orb of arcane light that flies in a line and hurts everything it passes through. */
export class ArcaneOrb extends Ability {
  readonly id = 'orb';
  readonly name = 'Arcane Orb';
  readonly hotkey = 'Q';
  readonly icon = 'classfx:orb_1';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly clampToRange = true;
  readonly castPoint = 0.25;
  readonly preview: Preview = { shape: 'line', width: 16 };

  orbDamage(level = this.level): number {
    return [0, 45, 70, 95][level];
  }
  manaCost(): number {
    return [0, 45, 55, 65][this.level];
  }
  cooldown(): number {
    return 6;
  }
  castRange(): number {
    return 8 * TILE;
  }
  describe(l: number): string {
    return `Launch a slow arcane orb that passes through enemies, dealing ${this.orbDamage(Math.max(1, l))} damage to each one it touches.`;
  }
  cast(hero: Hero, x: number, y: number): void {
    const dmg = this.orbDamage() + hero.talents.rank('orbMastery') * TV.orbMasteryDamage;
    hero.world.fireOrb(hero, Math.atan2(y - hero.y, x - hero.x), this.castRange(), dmg);
  }
}

/** W — ice bursts out of the ground around the mage, freezing every enemy nearby in place. */
export class FrostNova extends Ability {
  readonly id = 'nova';
  readonly name = 'Frost Nova';
  readonly hotkey = 'W';
  readonly icon = 'classfx:nova_3';
  readonly maxLevel = 3;
  readonly targeting = 'self' as const;
  readonly castPoint = 0.2;
  readonly radius = 3 * TILE;
  readonly preview: Preview = { shape: 'circle', radius: 3 * TILE };

  novaDamage(level = this.level): number {
    return [0, 40, 60, 85][level];
  }
  freeze(level = this.level): number {
    return [0, 1.5, 2, 2.5][level];
  }
  manaCost(): number {
    return [0, 60, 70, 80][this.level];
  }
  cooldown(): number {
    return [0, 12, 11, 10][this.level];
  }
  castRange(): number {
    return 0;
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Ice erupts around you: ${this.novaDamage(L)} damage to nearby enemies and they're frozen for ${this.freeze(L)}s.`;
  }
  cast(hero: Hero): void {
    const w = hero.world;
    const freeze = this.freeze() + hero.talents.rank('frostbite') * TV.frostbiteFreeze;
    w.spellFx('cfx_nova', hero.x, hero.y + 6, { width: this.radius * 2.1, originY: 0.75 });
    for (const u of w.enemiesInRadius(hero, hero.x, hero.y, this.radius)) {
      w.damage(u, this.novaDamage(), hero, { color: '#9fdcff' });
      u.stunTint = 0x8fd0ff;
      u.stun(freeze);
    }
  }
}

/** E — vanish in a column of light and reappear a few tiles away. */
export class Teleport extends Ability {
  readonly id = 'teleport';
  readonly name = 'Teleport';
  readonly hotkey = 'E';
  readonly icon = 'classfx:teleport_2';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly clampToRange = true;
  readonly castPoint = 0.1;
  readonly preview: Preview = { shape: 'line', width: 8 };

  manaCost(): number {
    return 40;
  }
  cooldown(): number {
    return [0, 10, 8, 6][this.level];
  }
  castRange(): number {
    return [5, 5, 6, 7][this.level] * TILE;
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Teleport up to ${[5, 5, 6, 7][L]} tiles away, over anything in between. ${this.cooldownFor(L)}s cooldown.`;
  }
  private cooldownFor(l: number): number {
    return [0, 10, 8, 6][l];
  }
  cast(hero: Hero, x: number, y: number): void {
    // Land on the furthest walkable spot along the line (you can blink over a fence, not into it).
    const map = hero.world.map;
    const dx = x - hero.x;
    const dy = y - hero.y;
    const len = Math.hypot(dx, dy);
    let to = { x: hero.x, y: hero.y };
    for (let d = len; d >= 0; d -= 4) {
      const px = hero.x + (dx / (len || 1)) * d;
      const py = hero.y + (dy / (len || 1)) * d;
      if (map.isWalkable(Math.floor(px / TILE), Math.floor(py / TILE))) {
        to = { x: px, y: py };
        break;
      }
    }
    hero.world.spellFx('cfx_teleport', hero.x, hero.y + 3, { width: 26, originY: 0.92 });
    hero.teleportTo(to.x, to.y);
    hero.world.spellFx('cfx_teleport', to.x, to.y + 3, { width: 26, originY: 0.92, delay: 90 });
  }
}

/** R — ultimate: a bubble of arcane force that soaks up damage. */
export class ArcaneShield extends Ability {
  readonly id = 'shield';
  readonly name = 'Arcane Shield';
  readonly hotkey = 'R';
  readonly icon = 'classfx:bubble_0';
  readonly maxLevel = 2;
  readonly targeting = 'self' as const;
  readonly castPoint = 0.1;

  requiredHeroLevel(nextLevel: number): number {
    return nextLevel * 6;
  }
  absorb(level = this.level): number {
    return [0, 260, 460][level];
  }
  manaCost(): number {
    return [0, 100, 140][this.level];
  }
  cooldown(): number {
    return [0, 45, 35][this.level];
  }
  castRange(): number {
    return 0;
  }
  describe(l: number): string {
    return `A bubble of arcane force surrounds you for 12s, absorbing up to ${this.absorb(Math.max(1, l))} damage.`;
  }
  cast(hero: Hero): void {
    hero.shieldUp(this.absorb(), 12);
    hero.world.burst(hero.x, hero.y - 10, 0x6ab0ff, 14);
  }
}

export function mageKit(): Ability[] {
  return [new ArcaneOrb(), new FrostNova(), new Teleport(), new ArcaneShield()];
}
