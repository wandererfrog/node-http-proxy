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
    // Arrows from the ranger concept sheet (2x density, drawn at half size like the hero): the basic
    // arrow, the green multi-shot arrow for Volley, and the glowing fire arrow for Searing Arrows.
    const fire = mode.kind === 'bolt' || (mode.kind === 'homing' && mode.fire);
    const frame = fire ? 'arrow_fire' : mode.kind === 'linear' ? 'arrow_volley' : 'arrow_basic';
    this.sprite = scene.add.image(this.x, this.y, 'rangerfx', frame).setOrigin(0.85, 0.5).setScale(0.5);
    if (fire) this.sprite.setBlendMode(Phaser.BlendModes.ADD);
    this.total = mode.kind === 'linear' ? mode.range : Math.max(1, source.dist(mode.target));
  }

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
            this.world.damage(m.target, this.damage, this.source, { color: '#ff9a3a' });
            this.world.burst(tx, ty, 0xff7a1f, 6);
            this.world.hitSpark(tx, ty);
          } else {
            this.world.damage(m.target, this.damage, this.source, m.fire ? { color: '#ff9a3a' } : {});
            if (m.fire) this.world.burst(tx, ty, 0xff7a1f, 5);
            this.world.hitSpark(tx, ty);
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
          this.world.hitSpark(u.x, u.y - 4);
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
  }

  private finish(): void {
    this.done = true;
    this.sprite.destroy();
  }

  private fade(): void {
    this.done = true;
    this.world.phaser.tweens.add({ targets: this.sprite, alpha: 0, duration: 150, onComplete: () => this.sprite.destroy() });
  }
}
