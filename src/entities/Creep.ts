import { TILE } from '../world/map';
import { Unit, UnitStats, World } from './Unit';

export type CreepKind = 'goblin' | 'ogre';

export const CREEP_STATS: Record<CreepKind, UnitStats & { xp: number }> = {
  goblin: {
    maxHp: 140, speed: 54, radius: 6, attackRange: 6, damage: [9, 13], attackCooldown: 1.4,
    damagePoint: 0.35, backswing: 0.3, acquireRange: 5 * TILE, ranged: false, xp: 30,
  },
  ogre: {
    maxHp: 420, speed: 46, radius: 8, attackRange: 8, damage: [24, 32], attackCooldown: 1.8,
    damagePoint: 0.5, backswing: 0.4, acquireRange: 5 * TILE, ranged: false, scale: 1.5, xp: 90,
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
    super(world, 'creep', kind, CREEP_STATS[kind], homeX, homeY);
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
