import Phaser from 'phaser';
import { TILE } from '../world/map';
import type { Unit, World } from './Unit';

const ARROW_SPEED = 260; // px/s
const BOLT_SPEED = 320; // px/s
const CHEST = 7; // px above the feet where arrows aim

/** An arrow in flight. Auto-attack arrows home in on their target; volley arrows fly straight. */
export class Arrow {
  readonly sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  done = false;
  private x: number;
  private y: number;
  private travelled = 0;
  private readonly total: number;

  constructor(
    private readonly world: World,
    private readonly source: Unit,
    private readonly damage: number,
    private readonly mode:
      | { kind: 'homing'; target: Unit; fire: boolean }
      | { kind: 'linear'; angle: number; range: number }
      | { kind: 'bolt'; target: Unit },
  ) {
    this.x = source.x + Math.cos(source.angle) * 4;
    this.y = source.y - CHEST;
    const scene = world.phaser;
    if (mode.kind === 'bolt') {
      // Animated magic bolt (2x density art drawn at half size) with a looping trail behind it.
      const s = scene.add.sprite(this.x, this.y, 'magic', 'bolt_0').setOrigin(0.7, 0.5).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD);
      s.play('magic_bolt');
      this.sprite = s;
      this.trail = scene.add.sprite(this.x, this.y, 'magic', 'trail_0').setOrigin(0.5, 0.5).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
      this.trail.play('magic_trail');
    } else {
      const fire = mode.kind === 'homing' && mode.fire;
      this.sprite = scene.add.image(this.x, this.y, fire ? 'arrow_fire' : 'arrow').setOrigin(0.8, 0.5);
    }
    this.total = mode.kind === 'linear' ? mode.range : Math.max(1, source.dist(mode.target));
  }

  private trail: Phaser.GameObjects.Sprite | null = null;

  update(dt: number): void {
    if (this.done) return;
    const m = this.mode;
    const step = (m.kind === 'bolt' ? BOLT_SPEED : ARROW_SPEED) * dt;
    let angle: number;
    if (m.kind === 'homing' || m.kind === 'bolt') {
      const tx = m.target.x;
      const ty = m.target.y - CHEST;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      angle = Math.atan2(dy, dx);
      if (d <= step + 2) {
        this.finish();
        if (!m.target.dead) {
          if (m.kind === 'bolt') {
            this.world.damage(m.target, this.damage, this.source, { color: '#9dffb0' });
            this.impact(tx, ty);
          } else {
            this.world.damage(m.target, this.damage, this.source, m.fire ? { color: '#ff9a3a' } : {});
            if (m.fire) this.world.burst(tx, ty, 0xff7a1f, 5);
          }
        }
        return;
      }
      if (m.target.dead) {
        this.fade();
        return;
      }
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    } else {
      angle = m.angle;
      this.x += Math.cos(angle) * step;
      this.y += Math.sin(angle) * step;
      const feetY = this.y + CHEST;
      if (this.world.map.blocksProjectiles(Math.floor(this.x / TILE), Math.floor(feetY / TILE))) {
        this.fade();
        return;
      }
      for (const u of this.world.units) {
        if (u.dead || !this.source.isEnemy(u) || !u.targetable) continue;
        if (Math.hypot(u.x - this.x, u.y - feetY) <= u.stats.radius + 4) {
          this.world.damage(u, this.damage, this.source, { color: '#8fd3ff' });
          this.finish();
          return;
        }
      }
    }
    this.travelled += step;
    if (m.kind === 'linear' && this.travelled >= m.range) {
      this.fade();
      return;
    }
    // A gentle arc so auto attacks read as lobbed arrows.
    const p = Math.min(1, this.travelled / this.total);
    const lift = m.kind === 'homing' ? Math.sin(p * Math.PI) * Math.min(10, this.total * 0.08) : 0;
    const slope = m.kind === 'homing' ? -Math.cos(p * Math.PI) * 0.35 : 0;
    this.sprite.setPosition(this.x, this.y - lift);
    this.sprite.setRotation(angle + (Math.cos(angle) >= 0 ? -slope : slope));
    this.sprite.setDepth(this.y + CHEST + 1);
    if (this.trail) {
      this.trail.setPosition(this.x - Math.cos(angle) * 8, this.y - Math.sin(angle) * 8).setRotation(angle).setDepth(this.y + CHEST);
    }
  }

  /** The impact burst from the magic sheet, played once where the bolt lands. */
  private impact(x: number, y: number): void {
    const fx = this.world.phaser.add.sprite(x, y, 'magic', 'impact_0').setOrigin(0.5, 0.5).setScale(0.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + CHEST + 2);
    fx.play('magic_impact');
    fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
  }

  private finish(): void {
    this.done = true;
    this.sprite.destroy();
    this.trail?.destroy();
  }

  private fade(): void {
    this.done = true;
    const targets = this.trail ? [this.sprite, this.trail] : [this.sprite];
    this.world.phaser.tweens.add({ targets, alpha: 0, duration: 150, onComplete: () => { this.sprite.destroy(); this.trail?.destroy(); } });
  }
}
