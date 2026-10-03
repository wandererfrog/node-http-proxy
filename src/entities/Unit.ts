import Phaser from 'phaser';
import { Facing } from '../art/sprites';
import { TILE, WorldMap } from '../world/map';
import { Point, planPath } from '../world/pathfinding';
import type { Ability } from '../abilities/Ability';

export type Team = 'player' | 'creep';

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; target: Unit }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'hold' }
  | { type: 'cast'; ability: Ability; x: number; y: number }
  /** Walk up to a rock tile and search it (hero only). */
  | { type: 'search'; tx: number; ty: number };

export interface DamageOpts {
  color?: string;
  big?: boolean;
}

/** What units need from the game scene. */
export interface World {
  readonly map: WorldMap;
  readonly units: Unit[];
  readonly phaser: Phaser.Scene;
  damage(target: Unit, amount: number, source: Unit | null, opts?: DamageOpts): void;
  /** Homing auto-attack arrow. */
  fireArrow(from: Unit, target: Unit, damage: number, fire: boolean): void;
  /** Straight skillshot arrow that hits the first enemy in its way. */
  fireVolleyArrow(from: Unit, angle: number, range: number, damage: number): void;
  enemiesInRadius(of: Unit, x: number, y: number, r: number): Unit[];
  fallingArrows(x: number, y: number, radius: number, count: number): void;
  /** A glowing spell glyph on the ground (additive), sized to `radius` px, for `duration` seconds. */
  glyph(key: string, x: number, y: number, radius: number, duration: number): void;
  floatText(x: number, y: number, text: string, color: string, big?: boolean): void;
  burst(x: number, y: number, color: number, count?: number): void;
  /** Break a searchable rock and hand out its loot. */
  searchRock(tx: number, ty: number): void;
}

export interface UnitStats {
  maxHp: number;
  speed: number; // px / s
  radius: number; // px, collision body
  attackRange: number; // px, edge to edge
  damage: [number, number];
  attackCooldown: number; // s
  damagePoint: number; // s from attack start until the hit/arrow release
  backswing: number; // s of follow-through after the hit, cancellable by moving
  acquireRange: number; // px
  ranged: boolean;
  scale?: number;
  /** px above the feet where the health bar sits (before scale) */
  barHeight: number;
  /** Extra draw scale for art authored at a higher resolution (e.g. 0.5 for 2x sprites). */
  spriteScale?: number;
}

/** WC3-ish turn rate: about 0.33s for a full 180° turn. Units only walk once roughly facing their heading. */
const TURN_RATE = Math.PI * 3;
const WALK_FACING_TOLERANCE = Math.PI / 3;
const ATTACK_FACING_TOLERANCE = Math.PI / 8;
const REPATH_INTERVAL = 0.3;

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Unit {
  x: number;
  y: number;
  hp: number;
  angle = Math.PI / 2; // facing down
  dead = false;
  /** Seconds left until another attack can start. */
  attackCd = 0;

  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;

  order: Order = { type: 'idle' };
  readonly queue: Order[] = [];

  /** Attack in progress: windup until the damage point, then backswing. */
  protected swing: { phase: 'windup' | 'backswing'; t: number; target: Unit } | null = null;
  /** Target picked up while attack-moving / holding / idling, kept separate from the order itself. */
  protected engaged: Unit | null = null;

  protected path: Point[] = [];
  private pathGoal: Point | null = null;
  private repathT = 0;
  private stuckT = 0;
  private scanT = 0;
  protected moving = false;
  private flashT = 0;
  /** Idle units pick fights with enemies in acquisition range and retaliate when hit. */
  protected autoAcquire = true;

  constructor(
    readonly world: World,
    readonly team: Team,
    readonly textureKey: string,
    readonly stats: UnitStats,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
    this.hp = stats.maxHp;
    const scene = world.phaser;
    const s = stats.scale ?? 1;
    this.shadow = scene.add.image(x, y, 'shadow').setOrigin(0.5, 0.5).setScale(Math.max(0.6, (s * stats.radius) / 8));
    this.sprite = scene.add.sprite(x, y, textureKey, 'down_idle').setOrigin(0.5, 1).setScale(s * (stats.spriteScale ?? 1));
  }

  get maxHp(): number {
    return this.stats.maxHp;
  }

  get speed(): number {
    return this.stats.speed;
  }

  /** Seconds between attacks; heroes shorten it with gear. */
  get attackCooldown(): number {
    return this.stats.attackCooldown;
  }

  get attackRange(): number {
    return this.stats.attackRange;
  }

  get alive(): boolean {
    return !this.dead;
  }

  isEnemy(o: Unit): boolean {
    return o.team !== this.team;
  }

  dist(o: { x: number; y: number }): number {
    return Math.hypot(o.x - this.x, o.y - this.y);
  }

  /** Gap between collision bodies. */
  gap(o: Unit): number {
    return this.dist(o) - this.stats.radius - o.stats.radius;
  }

  inAttackRange(o: Unit): boolean {
    return this.gap(o) <= this.attackRange;
  }

  // --- Orders -------------------------------------------------------------------------------

  /** Replace the current order (or queue it, WC3 shift-click style). */
  issue(order: Order, queued = false): void {
    if (this.dead) return;
    if (queued && this.order.type !== 'idle') {
      this.queue.push(order);
      return;
    }
    this.queue.length = 0;
    this.setOrder(order);
  }

  protected setOrder(order: Order): void {
    this.onOrderInterrupted();
    // A new order cancels a windup (no cooldown spent, the classic attack-cancel) and the backswing.
    if (this.swing && !(order.type === 'attack' && order.target === this.swing.target)) this.swing = null;
    this.order = order;
    this.engaged = null;
    this.path = [];
    this.pathGoal = null;
    this.moving = false;
    if (order.type === 'move' || order.type === 'attackMove') this.repath(order.x, order.y);
  }

  /** Hook for subclasses (e.g. cancelling a channel). */
  protected onOrderInterrupted(): void {}

  protected nextOrder(): void {
    const next = this.queue.shift();
    if (next) this.setOrder(next);
    else this.setOrder({ type: 'idle' });
  }

  stop(): void {
    this.issue({ type: 'idle' });
  }

  // --- Pathing & locomotion -----------------------------------------------------------------

  protected repath(x: number, y: number): boolean {
    const p = planPath(
      this.world.map,
      { x: this.x / TILE, y: this.y / TILE },
      { x: x / TILE, y: y / TILE },
      Math.min(0.45, this.stats.radius / TILE),
    );
    this.repathT = REPATH_INTERVAL;
    this.stuckT = 0;
    this.pathGoal = { x, y };
    if (!p) {
      this.path = [];
      return false;
    }
    this.path = p.map((q) => ({ x: q.x * TILE, y: q.y * TILE }));
    return true;
  }

  /** Turn toward an angle at the turn rate. Returns the remaining difference. */
  protected turnToward(target: number, dt: number): number {
    const d = angleDiff(this.angle, target);
    const step = TURN_RATE * dt;
    if (Math.abs(d) <= step) this.angle = target;
    else this.angle += Math.sign(d) * step;
    return Math.abs(angleDiff(this.angle, target));
  }

  /** Walk along the current path. Returns true when the end is reached. */
  protected followPath(dt: number): boolean {
    if (this.path.length === 0) {
      this.moving = false;
      return true;
    }
    const wp = this.path[0];
    const dx = wp.x - this.x;
    const dy = wp.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) {
      this.path.shift();
      return this.path.length === 0 ? ((this.moving = false), true) : this.followPath(dt);
    }
    const off = this.turnToward(Math.atan2(dy, dx), dt);
    if (off > WALK_FACING_TOLERANCE) {
      this.moving = false;
      return false;
    }
    this.moving = true;
    let step = this.speed * dt;
    const before = { x: this.x, y: this.y };
    if (step >= d) {
      this.x = wp.x;
      this.y = wp.y;
      this.path.shift();
      step -= d;
      if (this.path.length === 0) {
        this.moving = false;
        return true;
      }
    } else {
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
    // Stuck detection (e.g. body-blocked by other units): re-plan after a moment of no progress.
    const progressed = Math.hypot(this.x - before.x, this.y - before.y);
    if (progressed < this.speed * dt * 0.25) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 0.6 && this.pathGoal) this.repath(this.pathGoal.x, this.pathGoal.y);
    return false;
  }

  /** Move toward something that may itself be moving, re-planning periodically. */
  protected chase(tx: number, ty: number, dt: number): void {
    this.repathT -= dt;
    const goalDrift = this.pathGoal ? Math.hypot(this.pathGoal.x - tx, this.pathGoal.y - ty) : Infinity;
    if (this.path.length === 0 || (this.repathT <= 0 && goalDrift > 4) || goalDrift > TILE * 2) this.repath(tx, ty);
    this.followPath(dt);
  }

  // --- Combat -------------------------------------------------------------------------------

  protected findEnemy(range: number): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.world.units) {
      if (u.dead || !this.isEnemy(u) || !u.targetable) continue;
      const d = this.gap(u);
      if (d <= range && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  get targetable(): boolean {
    return !this.dead;
  }

  rollDamage(): number {
    const [a, b] = this.stats.damage;
    return Math.round(a + Math.random() * (b - a));
  }

  /**
   * Approach and attack `target`. Returns false when the target is gone.
   * `mayMove` false = hold position (only swing at what's already in range).
   */
  protected engage(target: Unit, dt: number, mayMove = true): boolean {
    if (target.dead || !target.targetable) {
      if (this.swing?.target === target) this.swing = null;
      return false;
    }
    if (this.swing) return true; // committed to the swing, handled in updateSwing
    if (!this.inAttackRange(target)) {
      if (!mayMove) return false;
      this.chase(target.x, target.y, dt);
      return true;
    }
    this.path = [];
    this.moving = false;
    const off = this.turnToward(Math.atan2(target.y - this.y, target.x - this.x), dt);
    if (off <= ATTACK_FACING_TOLERANCE && this.attackCd <= 0) {
      this.swing = { phase: 'windup', t: this.windupTime(), target };
      this.attackCd = this.attackCooldown;
    }
    return true;
  }

  protected windupTime(): number {
    return this.stats.damagePoint;
  }

  private updateSwing(dt: number): void {
    if (!this.swing) return;
    const s = this.swing;
    if (s.phase === 'windup') {
      this.turnToward(Math.atan2(s.target.y - this.y, s.target.x - this.x), dt);
      if (s.target.dead) {
        this.swing = null;
        return;
      }
      s.t -= dt;
      if (s.t <= 0) {
        this.releaseAttack(s.target);
        this.swing = { phase: 'backswing', t: this.stats.backswing, target: s.target };
      }
    } else {
      s.t -= dt;
      if (s.t <= 0) this.swing = null;
    }
  }

  protected releaseAttack(target: Unit): void {
    if (this.stats.ranged) this.world.fireArrow(this, target, this.rollDamage(), false);
    else if (this.gap(target) <= this.attackRange + 8) this.world.damage(target, this.rollDamage(), this);
  }

  /** Called by the world when this unit takes damage (after it's applied). */
  onDamaged(source: Unit | null): void {
    this.flashT = 0.08;
    // Idle units fight back, like in WC3.
    if (this.autoAcquire && source && !source.dead && this.order.type === 'idle' && !this.engaged) this.engaged = source;
  }

  // --- Main loop ----------------------------------------------------------------------------

  update(dt: number): void {
    if (this.dead) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.updateSwing(dt);
    if (!this.swing || this.swing.phase === 'backswing') this.runOrder(dt);
    // Moving out of a backswing cancels it (orb-walk feel).
    if (this.swing?.phase === 'backswing' && this.moving) this.swing = null;
    this.syncSprite(dt);
  }

  protected runOrder(dt: number): void {
    const o = this.order;
    switch (o.type) {
      case 'idle': {
        // Units that auto-acquired something give up if it runs far away.
        if (this.engaged && this.gap(this.engaged) > this.stats.acquireRange * 1.6) this.engaged = null;
        if (this.engaged && !this.engage(this.engaged, dt)) this.engaged = null;
        if (!this.engaged) {
          this.moving = false;
          this.scanT -= dt;
          if (this.autoAcquire && this.scanT <= 0) {
            this.scanT = 0.25;
            this.engaged = this.findEnemy(this.stats.acquireRange);
          }
        }
        break;
      }
      case 'hold': {
        this.moving = false;
        if (!this.engaged || !this.engage(this.engaged, dt, false)) {
          this.engaged = this.findEnemy(this.attackRange);
          if (this.engaged) this.engage(this.engaged, dt, false);
        }
        break;
      }
      case 'move': {
        if (this.followPath(dt)) this.nextOrder();
        break;
      }
      case 'attack': {
        if (!this.engage(o.target, dt)) this.nextOrder();
        break;
      }
      case 'attackMove': {
        if (this.engaged) {
          if (this.engage(this.engaged, dt)) break;
          // Target gone: resume the march.
          this.engaged = null;
          this.repath(o.x, o.y);
        }
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 0.2;
          const e = this.findEnemy(this.stats.acquireRange);
          if (e) {
            this.engaged = e;
            break;
          }
        }
        if (this.followPath(dt)) this.nextOrder();
        break;
      }
      case 'cast': {
        this.runCast(o, dt);
        break;
      }
    }
  }

  protected runCast(_o: Extract<Order, { type: 'cast' }>, _dt: number): void {
    this.nextOrder();
  }

  /** Separation so units don't stack. Pushes are cancelled if they'd shove a body into a wall. */
  static separate(units: Unit[], map: WorldMap): void {
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (a.dead || !a.solid) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (b.dead || !b.solid) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.stats.radius + b.stats.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const nx = d2 === 0 ? 1 : dx / d;
        const ny = d2 === 0 ? 0 : dy / d;
        // Units standing still (or attacking) are "heavier" than walking ones, so walkers flow around them.
        const wa = a.moving ? 1 : 0.35;
        const wb = b.moving ? 1 : 0.35;
        const s = wa + wb;
        a.nudge(-nx * push * (2 * wa) / s, -ny * push * (2 * wa) / s, map);
        b.nudge(nx * push * (2 * wb) / s, ny * push * (2 * wb) / s, map);
      }
    }
  }

  get solid(): boolean {
    return true;
  }

  private nudge(dx: number, dy: number, map: WorldMap): void {
    const r = this.stats.radius * 0.8;
    const ok = (x: number, y: number) =>
      map.isWalkable(Math.floor((x - r) / TILE), Math.floor((y - r) / TILE)) &&
      map.isWalkable(Math.floor((x + r) / TILE), Math.floor((y - r) / TILE)) &&
      map.isWalkable(Math.floor((x - r) / TILE), Math.floor((y + r) / TILE)) &&
      map.isWalkable(Math.floor((x + r) / TILE), Math.floor((y + r) / TILE));
    if (ok(this.x + dx, this.y)) this.x += dx;
    if (ok(this.x, this.y + dy)) this.y += dy;
  }

  // --- Presentation -------------------------------------------------------------------------

  /** Eight-way facing from the heading (y grows downwards). Left-facing octants mirror the right ones. */
  get facing(): { facing: Facing; flip: boolean } {
    const octant = (Math.round(this.angle / (Math.PI / 4)) % 8 + 8) % 8; // 0 = east, 2 = south
    const views: Array<[Facing, boolean]> = [
      ['side', false], ['downside', false], ['down', false], ['downside', true],
      ['side', true], ['upside', true], ['up', false], ['upside', false],
    ];
    const [facing, flip] = views[octant];
    return { facing, flip };
  }

  get attacking(): boolean {
    return this.swing !== null;
  }

  protected syncSprite(dt: number): void {
    const { facing, flip } = this.facing;
    const sp = this.sprite;
    sp.setPosition(Math.round(this.x), Math.round(this.y + 2));
    sp.setFlipX(flip);
    sp.setDepth(this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y + 2)).setDepth(this.y - 1000);
    if (this.swing?.phase === 'backswing') {
      sp.anims.stop();
      sp.setFrame(`${facing}_shoot`);
    } else if (this.attacking || this.poseOverride === 'attack') {
      sp.anims.stop();
      sp.setFrame(`${facing}_attack`);
    } else if (this.moving) {
      const key = `${this.textureKey}_walk_${facing}`;
      if (sp.anims.currentAnim?.key !== key || !sp.anims.isPlaying) sp.play(key, true);
    } else {
      sp.anims.stop();
      sp.setFrame(`${facing}_idle`);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      sp.setTintFill(0xffffff);
    } else {
      sp.clearTint();
    }
  }

  /** Lets subclasses force a pose (e.g. while channelling). */
  protected poseOverride: 'attack' | null = null;

  die(): void {
    this.dead = true;
    this.swing = null;
    this.path = [];
    this.moving = false;
    this.queue.length = 0;
    this.order = { type: 'idle' };
    const scene = this.world.phaser;
    this.sprite.anims.stop();
    this.sprite.setFrame(`${this.facing.facing}_death`).clearTint();
    this.sprite.setDepth(this.y - 8); // corpses lie under the living
    scene.tweens.add({
      targets: [this.sprite, this.shadow],
      alpha: 0,
      delay: 2500,
      duration: 900,
      onComplete: () => {
        this.sprite.setVisible(false);
        this.shadow.setVisible(false);
      },
    });
  }

  /** Bring a dead unit back at a spot with full health. */
  revive(x: number, y: number): void {
    this.dead = false;
    this.hp = this.maxHp;
    this.x = x;
    this.y = y;
    this.attackCd = 0;
    this.order = { type: 'idle' };
    this.engaged = null;
    this.world.phaser.tweens.killTweensOf([this.sprite, this.shadow]);
    this.sprite.setVisible(true).setAlpha(1).setAngle(0).clearTint();
    this.shadow.setVisible(true).setAlpha(1).setAngle(0);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
