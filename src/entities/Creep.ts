import { TILE } from '../world/map';
import { Unit, UnitStats, World } from './Unit';

export type CreepKind = 'skeleton' | 'boar' | 'alphaBoar';

export const CREEP_STATS: Record<CreepKind, UnitStats & { xp: number; texture: string }> = {
  skeleton: {
    texture: 'skeleton', maxHp: 150, speed: 38, radius: 6, attackRange: 7, damage: [10, 14], attackCooldown: 1.5,
    damagePoint: 0.4, backswing: 0.3, acquireRange: 5 * TILE, ranged: false, barHeight: 24, xp: 30,
  },
  boar: {
    texture: 'boar', maxHp: 190, speed: 44, radius: 7, attackRange: 5, damage: [12, 17], attackCooldown: 1.3,
    damagePoint: 0.3, backswing: 0.3, acquireRange: 5 * TILE, ranged: false, barHeight: 18, xp: 40,
  },
  alphaBoar: {
    texture: 'boar_alpha', maxHp: 480, speed: 40, radius: 10, attackRange: 6, damage: [24, 32], attackCooldown: 1.7,
    damagePoint: 0.45, backswing: 0.4, acquireRange: 5 * TILE, ranged: false, barHeight: 26, xp: 90,
  },
};

const LEASH = 11 * TILE;

/** A group of creeps guarding a spot. They aggro together, leash back home and respawn when cleared. */
export class Camp {
  readonly creeps: Creep[] = [];
  respawnT = 0;
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

  constructor(world: World, readonly kind: CreepKind, readonly camp: Camp, readonly homeX: number, readonly homeY: number) {
    super(world, 'creep', CREEP_STATS[kind].texture, CREEP_STATS[kind], homeX, homeY);
    this.xpValue = CREEP_STATS[kind].xp;
    this.angle = Math.random() * Math.PI * 2;
  }

  get targetable(): boolean {
    return !this.dead;
  }

  hunt(target: Unit): void {
    if (this.order.type === 'attack' && this.order.target === target) return;
    this.issue({ type: 'attack', target });
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
