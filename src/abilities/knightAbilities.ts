import { TILE } from '../world/map';
import type { Hero } from '../entities/Hero';
import { TALENT_VALUES as TV } from '../entities/talents';
import { Ability, Channel, Preview } from './Ability';

/** Q — slam the shield into whatever is in front of you: damage and a short stun. */
export class ShieldBash extends Ability {
  readonly id = 'bash';
  readonly name = 'Shield Bash';
  readonly hotkey = 'Q';
  readonly icon = 'classfx:bash_4';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly castPoint = 0.12;
  readonly preview: Preview = { shape: 'circle', radius: 18 };

  bashDamage(level = this.level): number {
    return [0, 35, 55, 75][level];
  }
  stunTime(level = this.level): number {
    return [0, 1, 1.5, 2][level];
  }
  manaCost(): number {
    return 25;
  }
  cooldown(): number {
    return 8;
  }
  castRange(): number {
    return 1.6 * TILE;
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Bash enemies in front of you with your shield: ${this.bashDamage(L)} damage and stunned for ${this.stunTime(L)}s.`;
  }
  cast(hero: Hero, x: number, y: number): void {
    const a = Math.atan2(y - hero.y, x - hero.x);
    const cx = hero.x + Math.cos(a) * 14;
    const cy = hero.y + Math.sin(a) * 14;
    hero.playMove('cfx_bash', 0.36, 'swing');
    const stun = this.stunTime() + hero.talents.rank('concussion') * TV.concussionStun;
    for (const u of hero.world.enemiesInRadius(hero, cx, cy, 18)) {
      hero.world.damage(u, this.bashDamage() + hero.rollDamage(), hero, { color: '#ffd84a' });
      u.stunTint = 0xffe08a;
      u.stun(stun);
      hero.world.hitSpark(u.x, u.y - 6);
    }
  }
}

/** W — spin with the sword out: everything around you is cut, again and again. Channelled. */
export class Whirlwind extends Ability {
  readonly id = 'whirl';
  readonly name = 'Whirlwind';
  readonly hotkey = 'W';
  readonly icon = 'classfx:whirl_2';
  readonly maxLevel = 3;
  readonly targeting = 'self' as const;
  readonly castPoint = 0;
  readonly radius = 2.2 * TILE;
  readonly preview: Preview = { shape: 'circle', radius: 2.2 * TILE };

  spinDamage(level = this.level): number {
    return [0, 16, 24, 32][level];
  }
  manaCost(): number {
    return [0, 40, 50, 60][this.level];
  }
  cooldown(): number {
    return 10;
  }
  castRange(): number {
    return 0;
  }
  describe(l: number): string {
    return `Spin for 1.5s, hitting every enemy around you 5 times for ${this.spinDamage(Math.max(1, l))} damage. Channelled.`;
  }
  cast(hero: Hero): Channel {
    const SPINS = 5;
    const GAP = 0.3;
    let t = 0;
    let spins = 0;
    const dmg = this.spinDamage() + hero.talents.rank('cyclone') * TV.cycloneDamage;
    hero.playMove('cfx_whirl', SPINS * GAP, 'spin');
    return {
      duration: SPINS * GAP,
      update: (dt) => {
        t += dt;
        while (spins < SPINS && t >= spins * GAP) {
          spins++;
          for (const u of hero.world.enemiesInRadius(hero, hero.x, hero.y, this.radius)) hero.world.damage(u, dmg, hero, { color: '#9fdcff' });
        }
      },
      end: () => hero.stopMove(),
    };
  }
}

/** E — leap to a spot and crash down: damage and a slow around where you land. */
export class LeapStrike extends Ability {
  readonly id = 'leap';
  readonly name = 'Leap Strike';
  readonly hotkey = 'E';
  readonly icon = 'classfx:leap_2';
  readonly maxLevel = 3;
  readonly targeting = 'point' as const;
  readonly clampToRange = true;
  readonly castPoint = 0.05;
  readonly radius = 1.8 * TILE;
  readonly preview: Preview = { shape: 'circle', radius: 1.8 * TILE };

  leapDamage(level = this.level): number {
    return [0, 40, 60, 80][level];
  }
  manaCost(): number {
    return 35;
  }
  cooldown(): number {
    return [0, 12, 10, 8][this.level];
  }
  castRange(): number {
    return [5, 5, 6, 7][this.level] * TILE;
  }
  describe(l: number): string {
    const L = Math.max(1, l);
    return `Leap up to ${[5, 5, 6, 7][L]} tiles and crash down for ${this.leapDamage(L)} damage around you, slowing enemies by half for 2s.`;
  }
  cast(hero: Hero, x: number, y: number): void {
    // Land on the furthest walkable spot along the line.
    const map = hero.world.map;
    const dx = x - hero.x;
    const dy = y - hero.y;
    const len = Math.hypot(dx, dy) || 1;
    let to = { x: hero.x, y: hero.y };
    for (let d = len; d >= 0; d -= 4) {
      const px = hero.x + (dx / len) * d;
      const py = hero.y + (dy / len) * d;
      if (map.isWalkable(Math.floor(px / TILE), Math.floor(py / TILE))) {
        to = { x: px, y: py };
        break;
      }
    }
    const DUR = 0.5;
    // A high leap with the sword raised, then the crash: the gold slash and dust where he lands.
    hero.dashTo(to.x, to.y, DUR, 14);
    hero.playMove('', DUR, 'swing');
    hero.world.phaser.time.delayedCall(DUR * 1000, () => {
      if (hero.dead) return;
      hero.playMove('cfx_leap', 0.4, 'swing');
      hero.world.burst(to.x, to.y, 0xffd84a, 12);
      for (const u of hero.world.enemiesInRadius(hero, to.x, to.y, this.radius)) {
        hero.world.damage(u, this.leapDamage(), hero, { color: '#ffd84a' });
        u.slow(0.5, 2);
      }
    });
  }
}

/** R — ultimate: a battle cry that draws every enemy nearby to you, while the shield takes the blows. */
export class Defender extends Ability {
  readonly id = 'defender';
  readonly name = 'Defender';
  readonly hotkey = 'R';
  readonly icon = 'classfx:taunt_3';
  readonly maxLevel = 2;
  readonly targeting = 'self' as const;
  readonly castPoint = 0.05;
  readonly radius = 6 * TILE;

  requiredHeroLevel(nextLevel: number): number {
    return nextLevel * 6;
  }
  reduction(level = this.level): number {
    return [0, 0.5, 0.65][level];
  }
  manaCost(): number {
    return [0, 80, 100][this.level];
  }
  cooldown(): number {
    return [0, 40, 30][this.level];
  }
  castRange(): number {
    return 0;
  }
  describe(l: number): string {
    return `Taunt every enemy within 6 tiles to attack you, and take ${Math.round(this.reduction(Math.max(1, l)) * 100)}% less damage for 8s.`;
  }
  cast(hero: Hero): void {
    hero.playMove('cfx_taunt', 0.55, 'guard');
    hero.defend(this.reduction(), 8);
    for (const u of hero.world.enemiesInRadius(hero, hero.x, hero.y, this.radius)) u.taunt(hero);
  }
}

export function knightKit(): Ability[] {
  return [new ShieldBash(), new Whirlwind(), new LeapStrike(), new Defender()];
}
