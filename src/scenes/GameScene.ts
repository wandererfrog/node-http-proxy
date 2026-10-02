import Phaser from 'phaser';
import { buildAllTextures, portraitDataUrl } from '../art/sprites';
import { ATLASES, IMAGES } from '../assets';
import { Ability } from '../abilities/Ability';
import { Camp, Creep, CreepKind } from '../entities/Creep';
import { Hero } from '../entities/Hero';
import { Arrow } from '../entities/Projectile';
import { DamageOpts, Unit, World } from '../entities/Unit';
import { Command, Hud } from '../ui/hud';
import { TILE, Tile, WorldMap } from '../world/map';

type Targeting = { kind: 'ability'; index: number } | { kind: 'attackMove' };

interface Marker {
  x: number;
  y: number;
  t: number;
  color: number;
}

interface TouchState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
}

const DEPTH_GROUND_FX = -100000;
const DEPTH_OVERLAY = 1e7;
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 6;

export class GameScene extends Phaser.Scene implements World {
  map!: WorldMap;
  units: Unit[] = [];
  hero!: Hero;
  private camps: Camp[] = [];
  private arrows: Arrow[] = [];
  private markers: Marker[] = [];
  private hud!: Hud;

  private fxGfx!: Phaser.GameObjects.Graphics;
  private barGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;

  private targeting: Targeting | null = null;
  /** Current aim point in world space while targeting (mouse hover, finger, or button-drag). */
  private aim: { x: number; y: number } | null = null;
  private buttonAim: number | null = null;

  private cameraLocked = true;
  /** device pixel ratio the canvas is rendered at; camera zoom = userZoom * dpr */
  private dpr = 1;
  private userZoom = 2;
  private touches = new Map<number, TouchState>();
  private pinch: { dist: number; zoom: number; midX: number; midY: number } | null = null;
  private gestureUsed = false;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super('game');
  }

  get phaser(): Phaser.Scene {
    return this;
  }

  preload(): void {
    for (const a of ATLASES) this.load.atlas(a.key, a.png, a.json);
    for (const i of IMAGES) this.load.image(i.key, i.png);
  }

  create(): void {
    this.dpr = (this.game.registry.get('dpr') as number) ?? 1;
    this.map = new WorldMap(80, 80, (Math.random() * 1e9) | 0);
    buildAllTextures(this, this.map);

    const worldW = this.map.width * TILE;
    const worldH = this.map.height * TILE;
    this.add.image(0, 0, 'ground').setOrigin(0, 0).setDepth(-1e6);
    this.placeProps();

    this.fxGfx = this.add.graphics().setDepth(DEPTH_GROUND_FX);
    this.barGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);
    this.aimGfx = this.add.graphics().setDepth(DEPTH_OVERLAY - 1);

    this.hero = new Hero(this, this.map.spawn.x * TILE, this.map.spawn.y * TILE);
    this.units.push(this.hero);
    for (const spec of this.map.camps) this.spawnCamp(spec.x * TILE, spec.y * TILE, spec.kind);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setBackgroundColor('#1f4a24');
    cam.setRoundPixels(true);
    this.userZoom = Phaser.Math.Clamp(Math.min(window.innerWidth, window.innerHeight) / 190, 2, 4);
    this.applyZoom();
    cam.centerOn(this.hero.x, this.hero.y);

    this.hud = new Hud(document.getElementById('ui')!, this.hero, this.map, portraitDataUrl(this), {
      abilityTap: (i) => this.onAbilityTap(i),
      abilityAim: (i, dx, dy) => this.onAbilityAim(i, dx, dy),
      abilityAimEnd: (i, cast) => this.onAbilityAimEnd(i, cast),
      learn: (i) => this.learn(i),
      command: (c) => this.onCommand(c),
      lockCamera: () => {
        this.cameraLocked = true;
      },
      minimapTap: (fx, fy) => {
        this.cameraLocked = false;
        cam.centerOn(fx * worldW, fy * worldH);
      },
      cancelTargeting: () => this.setTargeting(null),
    });

    this.setupInput();
    this.scale.on('resize', () => this.applyZoom());
    this.hud.toast('Tap to move · tap enemies to attack · learn an ability with +', 'info');
  }

  // --- World construction -------------------------------------------------------------------

  private placeProps(): void {
    for (let ty = 0; ty < this.map.height; ty++) {
      for (let tx = 0; tx < this.map.width; tx++) {
        const t = this.map.get(tx, ty);
        const v = this.map.variant[ty * this.map.width + tx];
        const bottom = (ty + 1) * TILE;
        if (t === Tile.Tree) {
          this.add.image(tx * TILE + 8 + ((v % 3) - 1), bottom + 1, `tree${v % 3}`).setOrigin(0.5, 1).setDepth(bottom - 3);
        } else if (t === Tile.Rock) {
          this.add.image(tx * TILE + 8, bottom, 'rock').setOrigin(0.5, 1).setDepth(bottom - 3);
        }
      }
    }
  }

  private spawnCamp(x: number, y: number, kind: 'skeletons' | 'boars'): void {
    const camp = new Camp(x, y);
    this.add.image(x, y + 4, 'logs').setOrigin(0.5, 1).setDepth(y + 4);
    const flame = this.add.image(x, y - 1, 'spark').setTint(0xff9a3a).setScale(2).setDepth(y + 5);
    this.tweens.add({ targets: flame, scaleX: 1.4, scaleY: 2.6, alpha: 0.7, yoyo: true, repeat: -1, duration: 220 });
    const kinds: CreepKind[] = kind === 'boars' ? ['alphaBoar', 'boar', 'boar'] : ['skeleton', 'skeleton', 'skeleton'];
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + 0.5;
      const r = k === 'alphaBoar' ? 0 : TILE * 1.2;
      const c = new Creep(this, k, camp, x + Math.cos(a) * r, y + Math.sin(a) * r + (k === 'alphaBoar' ? TILE * 0.9 : 0));
      camp.creeps.push(c);
      this.units.push(c);
    });
    this.camps.push(camp);
  }

  // --- World interface ----------------------------------------------------------------------

  damage(target: Unit, amount: number, source: Unit | null, opts: DamageOpts = {}): void {
    if (target.dead) return;
    target.hp -= amount;
    const isHero = target === this.hero;
    this.floatText(target.x, target.y - 18, `${Math.round(amount)}`, isHero ? '#ff6a5a' : (opts.color ?? '#ffffff'), opts.big);
    target.onDamaged(source);
    if (target.hp > 0) return;
    target.hp = 0;
    target.die();
    if (target instanceof Creep) {
      this.burst(target.x, target.y - 6, 0xff4a3a, 6);
      if (!this.hero.dead) {
        this.floatText(this.hero.x, this.hero.y - 26, `+${target.xpValue} xp`, '#c28cff');
        if (this.hero.gainXp(target.xpValue)) {
          this.hud.toast(`Level ${this.hero.level}! New skill point`, 'good');
          this.burst(this.hero.x, this.hero.y - 8, 0xffd84a, 14);
        }
      }
      if (target.camp.cleared) target.camp.respawnT = 45;
    } else if (isHero) {
      this.hud.toast('Sylva has fallen!', 'warn');
      this.setTargeting(null);
      for (const c of this.camps) for (const u of c.creeps) if (!u.dead && !u.returning) u.issue({ type: 'idle' });
    }
  }

  fireArrow(from: Unit, target: Unit, damage: number, fire: boolean): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'homing', target, fire }));
  }

  fireVolleyArrow(from: Unit, angle: number, range: number, damage: number): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'linear', angle, range }));
  }

  enemiesInRadius(of: Unit, x: number, y: number, r: number): Unit[] {
    return this.units.filter((u) => !u.dead && of.isEnemy(u) && Math.hypot(u.x - x, u.y - y) <= r + u.stats.radius);
  }

  fallingArrows(x: number, y: number, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const gx = x + Math.cos(a) * r;
      const gy = y + Math.sin(a) * r;
      const img = this.add.image(gx - 10, gy - 70, 'arrow').setRotation(Math.atan2(70, 10)).setDepth(gy + 1);
      this.tweens.add({
        targets: img,
        x: gx,
        y: gy,
        duration: 260,
        ease: 'Quad.easeIn',
        onComplete: () => {
          this.tweens.add({ targets: img, alpha: 0, duration: 300, delay: 150, onComplete: () => img.destroy() });
          if (Math.random() < 0.3) this.burst(gx, gy, 0xd8c8a0, 1);
        },
      });
    }
  }

  floatText(x: number, y: number, text: string, color: string, big = false): void {
    const t = this.add
      .text(Math.round(x), Math.round(y), text, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: big ? '8px' : '6px',
        color,
        stroke: '#1a1c2c',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setResolution(Math.max(2, Math.ceil(this.cameras.main.zoom)))
      .setDepth(DEPTH_OVERLAY + 1);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  burst(x: number, y: number, color: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const p = this.add.image(x, y, 'spark').setTint(color).setDepth(DEPTH_OVERLAY - 2).setScale(0.6 + Math.random() * 0.6);
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 10;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d - 4,
        alpha: 0,
        scale: 0.2,
        duration: 300 + Math.random() * 250,
        onComplete: () => p.destroy(),
      });
    }
  }

  // --- Input --------------------------------------------------------------------------------

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('LEFT,RIGHT,UP,DOWN') as Record<string, Phaser.Input.Keyboard.Key>;

    kb.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const abIdx = this.hero.abilities.findIndex((a) => a.hotkey.toLowerCase() === k);
      if (abIdx >= 0) {
        // Ctrl+key learns the ability, like a quick version of WC3's hero skill menu.
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.learn(abIdx);
        } else this.onAbilityTap(abIdx);
        return;
      }
      if (k === 'a') this.onCommand('attack');
      else if (k === 's') this.onCommand('stop');
      else if (k === 'h') this.onCommand('hold');
      else if (k === 'escape') this.setTargeting(null);
      else if (k === ' ' || k === 'f1') {
        this.cameraLocked = true;
        e.preventDefault();
      }
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        // Right-click: WC3 smart order, or cancel targeting.
        if (this.targeting) this.setTargeting(null);
        else this.smartOrder(p.worldX, p.worldY, this.shiftHeld(p));
        return;
      }
      this.touches.set(p.id, { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, dragged: false });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = {
          dist: Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY),
          zoom: this.userZoom,
          midX: (a.lastX + b.lastX) / 2,
          midY: (a.lastY + b.lastY) / 2,
        };
        this.gestureUsed = true;
      } else if (this.touches.size === 1 && this.targeting) {
        this.aim = { x: p.worldX, y: p.worldY };
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const t = this.touches.get(p.id);
      if (!t) {
        // Mouse hover drives the targeting preview on desktop.
        if (this.targeting && !p.wasTouch && this.buttonAim === null) this.aim = { x: p.worldX, y: p.worldY };
        return;
      }
      const cam = this.cameras.main;
      if (this.pinch && this.touches.size >= 2) {
        t.lastX = p.x;
        t.lastY = p.y;
        const [a, b] = [...this.touches.values()];
        const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
        const midX = (a.lastX + b.lastX) / 2;
        const midY = (a.lastY + b.lastY) / 2;
        this.userZoom = Phaser.Math.Clamp(this.pinch.zoom * (dist / Math.max(1, this.pinch.dist)), MIN_ZOOM, MAX_ZOOM);
        this.applyZoom();
        cam.scrollX -= (midX - this.pinch.midX) / cam.zoom;
        cam.scrollY -= (midY - this.pinch.midY) / cam.zoom;
        this.pinch.midX = midX;
        this.pinch.midY = midY;
        this.cameraLocked = false;
        return;
      }
      const dx = p.x - t.lastX;
      const dy = p.y - t.lastY;
      t.lastX = p.x;
      t.lastY = p.y;
      if (this.targeting) {
        // While picking a target, dragging moves the reticle instead of the camera.
        this.aim = { x: p.worldX, y: p.worldY };
        return;
      }
      if (!t.dragged && Math.hypot(p.x - t.startX, p.y - t.startY) > 12 * this.dpr) t.dragged = true;
      if (t.dragged) {
        cam.scrollX -= dx / cam.zoom;
        cam.scrollY -= dy / cam.zoom;
        this.cameraLocked = false;
      }
    });

    const release = (p: Phaser.Input.Pointer) => {
      const t = this.touches.get(p.id);
      if (!t) return;
      this.touches.delete(p.id);
      if (this.touches.size < 2) this.pinch = null;
      const wasGesture = this.gestureUsed;
      if (this.touches.size === 0) this.gestureUsed = false;
      if (t.dragged || wasGesture) return;
      this.onTap(p.worldX, p.worldY, this.shiftHeld(p));
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.userZoom = Phaser.Math.Clamp(this.userZoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM);
      this.applyZoom();
    });
  }

  private shiftHeld(p: Phaser.Input.Pointer): boolean {
    return !!(p.event as MouseEvent | undefined)?.shiftKey;
  }

  private applyZoom(): void {
    this.cameras.main.setZoom(this.userZoom * this.dpr);
  }

  /** Enemy under a world point, with generous hit radius for fingers. */
  private enemyAt(x: number, y: number): Unit | null {
    const slop = 10 / (this.cameras.main.zoom / this.dpr) + 4;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.dead || !this.hero.isEnemy(u)) continue;
      // Units are drawn above their feet, so test against the body centre.
      const d = Math.hypot(u.x - x, u.y - 7 * (u.stats.scale ?? 1) - y);
      if (d < u.stats.radius + slop && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private onTap(x: number, y: number, queued: boolean): void {
    if (this.hero.dead) return;
    if (this.targeting) {
      const tg = this.targeting;
      if (tg.kind === 'attackMove') {
        const e = this.enemyAt(x, y);
        if (e) this.hero.issue({ type: 'attack', target: e }, queued);
        else this.hero.issue({ type: 'attackMove', x, y }, queued);
        this.addMarker(x, y, 0xff4a3a);
      } else {
        this.castAt(tg.index, x, y, queued);
      }
      if (!queued) this.setTargeting(null);
      return;
    }
    this.smartOrder(x, y, queued);
  }

  /** WC3 right-click: attack an enemy under the cursor, otherwise move. */
  private smartOrder(x: number, y: number, queued: boolean): void {
    if (this.hero.dead) return;
    const e = this.enemyAt(x, y);
    if (e) {
      this.hero.issue({ type: 'attack', target: e }, queued);
      this.addMarker(e.x, e.y, 0xff4a3a);
    } else {
      this.hero.issue({ type: 'move', x, y }, queued);
      this.addMarker(x, y, 0x7dff6a);
    }
  }

  private castAt(i: number, x: number, y: number, queued = false): void {
    const err = this.hero.useAbility(this.hero.abilities[i], x, y, queued);
    if (err) this.hud.toast(err, 'warn');
    else this.addMarker(x, y, 0xffd84a);
  }

  private setTargeting(t: Targeting | null): void {
    this.targeting = t;
    this.aim = null;
    if (!t) {
      this.hud.setTargeting(null);
      this.hud.setActiveCommand(null);
      return;
    }
    if (t.kind === 'attackMove') {
      this.hud.setTargeting('Attack-move: tap a spot or an enemy');
      this.hud.setActiveCommand('attack');
    } else {
      this.hud.setTargeting(`${this.hero.abilities[t.index].name}: tap the map (drag to aim)`);
      this.hud.setActiveCommand(null);
    }
  }

  private onAbilityTap(i: number): void {
    const ab = this.hero.abilities[i];
    if (ab.targeting === 'toggle') {
      const err = this.hero.useAbility(ab);
      if (err) this.hud.toast(ab.level === 0 ? `${ab.name}: learn it first (+)` : err, 'warn');
      else this.hud.toast(`${ab.name}: autocast ${(ab as unknown as { autocast: boolean }).autocast ? 'ON' : 'OFF'}`);
      return;
    }
    const why = ab.blocked(this.hero);
    if (why) {
      this.hud.toast(ab.level === 0 ? `${ab.name}: learn it first (+)` : why, 'warn');
      return;
    }
    if (this.targeting?.kind === 'ability' && this.targeting.index === i) this.setTargeting(null);
    else this.setTargeting({ kind: 'ability', index: i });
  }

  private onAbilityAim(i: number, dx: number, dy: number): void {
    const ab = this.hero.abilities[i];
    if (ab.blocked(this.hero)) return;
    this.buttonAim = i;
    if (this.targeting?.kind !== 'ability' || this.targeting.index !== i) this.setTargeting({ kind: 'ability', index: i });
    const len = Math.hypot(dx, dy);
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 1;
    const range = ab.castRange();
    const reach = ab.preview?.shape === 'cone' ? range * 0.6 : Math.min(1, len) * range;
    this.aim = { x: this.hero.x + ux * reach, y: this.hero.y + uy * reach };
  }

  private onAbilityAimEnd(i: number, cast: boolean): void {
    this.buttonAim = null;
    if (cast && this.aim) this.castAt(i, this.aim.x, this.aim.y);
    this.setTargeting(null);
  }

  private onCommand(c: Command): void {
    if (this.hero.dead) return;
    if (c === 'stop') {
      this.hero.stop();
      this.setTargeting(null);
    } else if (c === 'hold') {
      this.hero.issue({ type: 'hold' });
      this.setTargeting(null);
    } else {
      this.setTargeting(this.targeting?.kind === 'attackMove' ? null : { kind: 'attackMove' });
    }
  }

  private learn(i: number): void {
    const ab = this.hero.abilities[i];
    if (this.hero.learn(ab)) {
      this.hud.toast(`${ab.name} — level ${ab.level}`, 'good');
      this.burst(this.hero.x, this.hero.y - 8, 0xffd84a, 8);
    } else if (this.hero.skillPoints === 0) this.hud.toast('No skill points', 'warn');
    else if (ab.level >= ab.maxLevel) this.hud.toast('Already at max level', 'warn');
    else this.hud.toast(`Requires hero level ${ab.requiredHeroLevel(ab.level + 1)}`, 'warn');
  }

  private addMarker(x: number, y: number, color: number): void {
    this.markers.push({ x, y, t: 0, color });
  }

  // --- Main loop ----------------------------------------------------------------------------

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);

    for (const u of this.units) u.update(dt);
    Unit.separate(this.units, this.map);
    for (const a of this.arrows) a.update(dt);
    this.arrows = this.arrows.filter((a) => !a.done);

    this.updateRespawns(dt);
    this.updateCamera(dt);
    this.drawMarkers(dt);
    this.drawBars();
    this.drawAim();

    const cam = this.cameras.main;
    this.hud.update(this.units, { x: cam.worldView.x, y: cam.worldView.y, w: cam.worldView.width, h: cam.worldView.height }, this.cameraLocked);
  }

  private updateRespawns(dt: number): void {
    const h = this.hero;
    if (h.dead && h.respawnT <= 0) {
      h.revive(this.map.spawn.x * TILE, this.map.spawn.y * TILE);
      this.cameraLocked = true;
      this.burst(h.x, h.y - 8, 0x7dff6a, 14);
      this.hud.toast('Sylva returns!', 'good');
    }
    for (const camp of this.camps) {
      if (!camp.cleared) continue;
      camp.respawnT -= dt;
      const heroNear = !h.dead && Math.hypot(h.x - camp.x, h.y - camp.y) < 9 * TILE;
      if (camp.respawnT <= 0 && !heroNear) {
        for (const c of camp.creeps) {
          c.revive(c.homeX, c.homeY);
          c.returning = false;
        }
      }
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const pan = (400 * dt) / (cam.zoom / this.dpr);
    const k = this.keys;
    if (k.LEFT.isDown || k.RIGHT.isDown || k.UP.isDown || k.DOWN.isDown) {
      this.cameraLocked = false;
      cam.scrollX += ((k.RIGHT.isDown ? 1 : 0) - (k.LEFT.isDown ? 1 : 0)) * pan;
      cam.scrollY += ((k.DOWN.isDown ? 1 : 0) - (k.UP.isDown ? 1 : 0)) * pan;
    }
    if (this.cameraLocked) {
      // Smooth follow; the camera works in scroll space so convert from the centre.
      const tx = this.hero.x - cam.width / 2;
      const ty = this.hero.y - cam.height / 2;
      const f = 1 - Math.pow(0.0005, dt);
      cam.scrollX += (tx - cam.scrollX) * f;
      cam.scrollY += (ty - cam.scrollY) * f;
    }
  }

  private drawMarkers(dt: number): void {
    const g = this.fxGfx;
    g.clear();
    for (const m of this.markers) m.t += dt;
    this.markers = this.markers.filter((m) => m.t < 0.5);
    for (const m of this.markers) {
      const p = m.t / 0.5;
      const r = 7 * (1 - p) + 2;
      g.lineStyle(1.5, m.color, 1 - p);
      g.strokeEllipse(m.x, m.y, r * 2, r * 1.2);
      // Four little chevrons closing in, WC3 style.
      const c = 10 * (1 - p) + 2;
      g.fillStyle(m.color, 1 - p);
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.fillRect(m.x + ox * c - 1, m.y + oy * c * 0.6 - 1, 2, 2);
    }
    // Selection circle under the hero.
    if (!this.hero.dead) {
      g.lineStyle(1, 0x7dff6a, 0.9);
      g.strokeEllipse(this.hero.x, this.hero.y + 1, 14, 7);
    }
  }

  private drawBars(): void {
    const g = this.barGfx;
    g.clear();
    for (const u of this.units) {
      if (u.dead) continue;
      const s = u.stats.scale ?? 1;
      const w = Math.round(14 * s);
      const x = Math.round(u.x - w / 2);
      const y = Math.round(u.y - u.stats.barHeight * s);
      const p = Math.max(0, u.hp / u.maxHp);
      const isHero = u === this.hero;
      if (!isHero && p >= 1 && u.order.type === 'idle') continue; // keep the screen calm
      g.fillStyle(0x1a1c2c, 0.9);
      g.fillRect(x - 1, y - 1, w + 2, isHero ? 5 : 3);
      g.fillStyle(p > 0.5 ? 0x3fbf4a : p > 0.25 ? 0xe0c030 : 0xd0301a, 1);
      g.fillRect(x, y, Math.max(0, Math.round(w * p)), 1);
      if (isHero) {
        const h = this.hero;
        g.fillStyle(0x3a7ae8, 1);
        g.fillRect(x, y + 2, Math.round(w * (h.mana / h.maxMana)), 1);
        if (h.isEmpowered) {
          g.lineStyle(1, 0x9be08a, 0.8 + Math.sin(this.time.now / 80) * 0.2);
          g.strokeEllipse(h.x, h.y + 1, 18, 9);
        }
      }
    }
  }

  private drawAim(): void {
    const g = this.aimGfx;
    g.clear();
    const t = this.targeting;
    const h = this.hero;
    if (!t || h.dead) return;
    if (t.kind === 'attackMove') {
      if (this.aim) {
        g.lineStyle(1, 0xff4a3a, 0.9);
        g.strokeCircle(this.aim.x, this.aim.y, 5);
        g.lineBetween(this.aim.x - 8, this.aim.y, this.aim.x + 8, this.aim.y);
        g.lineBetween(this.aim.x, this.aim.y - 8, this.aim.x, this.aim.y + 8);
      }
      return;
    }
    const ab: Ability = h.abilities[t.index];
    const range = ab.castRange();
    // Cast range ring.
    g.lineStyle(1, 0xffffff, 0.35);
    g.strokeCircle(h.x, h.y, range);
    if (!this.aim) return;
    let ax = this.aim.x;
    let ay = this.aim.y;
    const d = Math.hypot(ax - h.x, ay - h.y);
    const out = d > range;
    if (out && ab.clampToRange) {
      ax = h.x + ((ax - h.x) / d) * range;
      ay = h.y + ((ay - h.y) / d) * range;
    }
    const col = out && !ab.clampToRange ? 0xffd84a : 0x7dff6a;
    const pv = ab.preview;
    g.fillStyle(col, 0.18);
    g.lineStyle(1, col, 0.9);
    if (pv?.shape === 'circle') {
      g.fillCircle(ax, ay, pv.radius);
      g.strokeCircle(ax, ay, pv.radius);
    } else if (pv?.shape === 'cone') {
      const a = Math.atan2(ay - h.y, ax - h.x);
      g.beginPath();
      g.moveTo(h.x, h.y);
      g.arc(h.x, h.y, pv.length, a - (pv.spread / 2), a + (pv.spread / 2));
      g.closePath();
      g.fillPath();
      g.strokePath();
    } else if (pv?.shape === 'line') {
      g.lineStyle(pv.width, col, 0.25);
      g.lineBetween(h.x, h.y, ax, ay);
      g.lineStyle(1, col, 0.9);
      g.strokeCircle(ax, ay, 5);
    }
  }
}
