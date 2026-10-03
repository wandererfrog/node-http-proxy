import Phaser from 'phaser';
import { TILE, Tile } from '../world/map';
import type { Unit, World } from './Unit';

const ARROW_SPEED = 260; // px/s
const BOLT_SPEED = 320; // px/s
const ARCANE_SPEED = 230; // px/s, the Mage's attack
const ORB_SPEED = 95; // px/s, Arcane Orb drifts
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
      | { kind: 'homing'; target: Unit; fire: boolean; crit?: boolean }
      | { kind: 'linear'; angle: number; range: number }
      | { kind: 'bolt'; target: Unit; crit?: boolean }
      /** The Mage's attack: a homing bolt of arcane light. */
      | { kind: 'arcane'; target: Unit; crit?: boolean }
      /** Arcane Orb: drifts in a straight line through enemies, hurting each one once. */
      | { kind: 'orb'; angle: number; range: number },
  ) {
    this.x = source.x + Math.cos(source.angle) * 4;
    this.y = source.y - CHEST;
    const scene = world.phaser;
    // Arrows from the ranger concept sheet (2x density, drawn at half size like the hero): the basic
    // arrow, the green multi-shot arrow for Volley, and the glowing fire arrow for Searing Arrows.
    if (mode.kind === 'arcane' || mode.kind === 'orb') {
      // The Mage's light, from the mage sheet's Magic Bolt and Arcane Orb loops.
      const s = scene.add.sprite(this.x, this.y, 'classfx', mode.kind === 'orb' ? 'orb_0' : 'bolt_5');
      s.play(mode.kind === 'orb' ? 'cfx_orb' : 'cfx_bolt').setBlendMode(Phaser.BlendModes.ADD);
      s.setOrigin(mode.kind === 'orb' ? 0.5 : 0.75, 0.5).setScale(mode.kind === 'orb' ? 0.42 : 0.36);
      this.sprite = s;
    } else {
      const fire = mode.kind === 'bolt' || (mode.kind === 'homing' && mode.fire);
      const frame = fire ? 'arrow_fire' : mode.kind === 'linear' ? 'arrow_volley' : 'arrow_basic';
      this.sprite = scene.add.image(this.x, this.y, 'rangerfx', frame).setOrigin(0.85, 0.5).setScale(0.5);
      if (fire) this.sprite.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.total = mode.kind === 'linear' || mode.kind === 'orb' ? mode.range : Math.max(1, source.dist(mode.target));
  }

  /** Enemies the orb has already hurt. */
  private readonly hit = new Set<Unit>();

  update(dt: number): void {
    if (this.done) return;
    const m = this.mode;
    const step = (m.kind === 'bolt' ? BOLT_SPEED : m.kind === 'arcane' ? ARCANE_SPEED : m.kind === 'orb' ? ORB_SPEED : ARROW_SPEED) * dt;
    let angle: number;
    if (m.kind === 'orb') {
      angle = m.angle;
      this.x += Math.cos(angle) * step;
      this.y += Math.sin(angle) * step;
      const feetY = this.y + CHEST;
      for (const u of this.world.units) {
        if (u.dead || this.hit.has(u) || !this.source.isEnemy(u) || !u.targetable) continue;
        if (Math.hypot(u.x - this.x, u.y - feetY) <= u.stats.radius + 9) {
          this.hit.add(u);
          this.world.damage(u, this.damage, this.source, { color: '#c8a8ff' });
          this.world.burst(u.x, u.y - 6, 0x8a7aff, 6);
        }
      }
      this.travelled += step;
      if (this.travelled >= m.range || this.world.map.get(Math.floor(this.x / TILE), Math.floor(feetY / TILE)) === Tile.Wall) {
        this.fade();
        return;
      }
      this.sprite.setPosition(this.x, this.y).setDepth(this.y + CHEST + 1);
      return;
    }
    if (m.kind === 'homing' || m.kind === 'bolt' || m.kind === 'arcane') {
      const tx = m.target.x;
      const ty = m.target.y - CHEST;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      angle = Math.atan2(dy, dx);
      if (d <= step + 2) {
        this.finish();
        if (!m.target.dead) {
          if (m.kind === 'arcane') {
            this.world.damage(m.target, this.damage, this.source, m.crit ? { color: '#ffd84a', big: true } : { color: '#9fd0ff' });
            this.world.burst(tx, ty, 0x6ab0ff, 5);
          } else if (m.kind === 'bolt') {
            this.world.damage(m.target, this.damage, this.source, m.crit ? { color: '#ffd84a', big: true } : { color: '#ff9a3a' });
            this.world.burst(tx, ty, 0xff7a1f, 6);
            this.world.hitSpark(tx, ty);
          } else {
            this.world.damage(m.target, this.damage, this.source, m.crit ? { color: '#ffd84a', big: true } : m.fire ? { color: '#ff9a3a' } : {});
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
