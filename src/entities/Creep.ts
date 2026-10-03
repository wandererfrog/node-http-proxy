import { TILE } from '../world/map';
import { CreepKind, creepDamage, creepMaxHp, creepXp } from './balance';
import { Unit, UnitStats, World } from './Unit';

export type { CreepKind };

/** Level-1 stats; hp, damage and xp scale with the camp's level (see balance.ts). */
export const CREEP_STATS: Record<CreepKind, Omit<UnitStats, 'maxHp'> & { texture: string }> = {
  skeleton: {
    texture: 'skeleton', speed: 30, radius: 6, attackRange: 7, damage: [10, 14], attackCooldown: 1.5,
    damagePoint: 0.4, backswing: 0.3, acquireRange: 5 * TILE, ranged: false, barHeight: 25, spriteScale: 0.5,
  },
  boar: {
    texture: 'boar', speed: 34, radius: 7, attackRange: 5, damage: [12, 17], attackCooldown: 1.3,
    damagePoint: 0.3, backswing: 0.3, acquireRange: 5 * TILE, ranged: false, barHeight: 22, spriteScale: 0.5,
  },
  alphaBoar: {
    texture: 'boar_alpha', speed: 32, radius: 10, attackRange: 6, damage: [24, 32], attackCooldown: 1.7,
    damagePoint: 0.45, backswing: 0.4, acquireRange: 5 * TILE, ranged: false, barHeight: 31, spriteScale: 0.5,
  },
};

function statsFor(kind: CreepKind, level: number): UnitStats {
  const base = CREEP_STATS[kind];
  return { ...base, maxHp: creepMaxHp(kind, level), damage: creepDamage(base.damage, level) };
}

const LEASH = 11 * TILE;

/** A group of creeps guarding a spot. They aggro together, leash back home and respawn when cleared. */
export class Camp {
  readonly creeps: Creep[] = [];
  respawnT = 0;
  /** Index in the map's camp list (dungeon camps are remembered as cleared by it). */
  index = -1;
  constructor(readonly x: number, readonly y: number) {}

  get cleared(): boolean {
    return this.creeps.every((c) => c.dead);
  }

  aggro(target: Unit): void {
    for (const c of this.creeps) if (!c.dead && !c.returning) c.hunt(target);
  }
}

export class Creep extends Unit {
  returning = false;
  private wanderT = Math.random() * 4;
  readonly xpValue: number;

  constructor(
    world: World,
    readonly kind: CreepKind,
    readonly level: number,
    readonly camp: Camp,
    readonly homeX: number,
    readonly homeY: number,
  ) {
    super(world, 'creep', CREEP_STATS[kind].texture, statsFor(kind, level), homeX, homeY);
    this.xpValue = creepXp(kind, level);
    this.angle = Math.random() * Math.PI * 2;
  }

  get targetable(): boolean {
    return !this.dead;
  }

  hunt(target: Unit): void {
    if (this.order.type === 'attack' && this.order.target === target) return;
    this.issue({ type: 'attack', target });
  }

  taunt(target: Unit): void {
    if (this.returning) return;
    this.hunt(target);
  }

  onDamaged(source: Unit | null): void {
    super.onDamaged(source);
    if (source && !this.returning) this.camp.aggro(source);
  }

  update(dt: number): void {
    if (this.dead) return;
    const fromHome = Math.hypot(this.x - this.homeX, this.y - this.homeY);

    if (this.returning) {
      // Running home: regenerate fast and ignore everything, like WC3 creeps.
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
      if (this.order.type !== 'move') this.returning = false;
    } else if (this.order.type === 'attack') {
      if (fromHome > LEASH || this.order.target.dead) this.goHome();
    } else {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02 * dt);
      const target = this.findEnemy(this.stats.acquireRange);
      if (target && Math.hypot(target.x - this.homeX, target.y - this.homeY) < LEASH * 0.8) {
        this.camp.aggro(target);
      } else if (this.order.type === 'idle') {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 3 + Math.random() * 5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * TILE;
          this.issue({ type: 'move', x: this.homeX + Math.cos(a) * r, y: this.homeY + Math.sin(a) * r });
        }
      }
    }
    super.update(dt);
  }

  /** The camp AI decides who to fight, not the generic idle auto-acquire. */
  protected autoAcquire = false;

  private goHome(): void {
    this.returning = true;
    this.issue({ type: 'move', x: this.homeX, y: this.homeY });
  }
}
