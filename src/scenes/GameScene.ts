import Phaser from 'phaser';
import { buildAllTextures, frameDataUrl, portraitDataUrl } from '../art/sprites';
import { DENSITY, buildGround } from '../art/ground';
import { ENV_ATLAS, PROPS } from '../world/props';
import { ATLASES, IMAGES } from '../assets';
import { Ability } from '../abilities/Ability';
import { Camp, Creep } from '../entities/Creep';
import { CREEP_GEAR_DROP, CREEP_POTION_DROP } from '../entities/balance';
import { Gear, GearSlot, ITEMS, ItemId, TIERS, TOMES, TOME_IDS, rollGear } from '../entities/items';
import { Hero } from '../entities/Hero';
import { Arrow } from '../entities/Projectile';
import { DamageOpts, Unit, World } from '../entities/Unit';
import { Command, Hud } from '../ui/hud';
import { CampSpec, TILE, Tile, WorldMap } from '../world/map';

interface Chest {
  img: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
  camp: Camp;
  level: number;
  opened: boolean;
}

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
/** px around the moonwell's healing circle */
const MOONWELL_RADIUS = TILE * 2.2;
/** Drawn size of the healing circle glyph (px across). */
const MOONWELL_GLYPH = TILE * 2.6;
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 6;

export class GameScene extends Phaser.Scene implements World {
  map!: WorldMap;
  units: Unit[] = [];
  hero!: Hero;
  private camps: Camp[] = [];
  /** Searchable rocks by tile index. */
  private rocks = new Map<number, Phaser.GameObjects.Image>();
  /** Trees, culled to the camera view so the renderer skips the thousands off-screen. */
  private props: Phaser.GameObjects.Image[] = [];
  private wellGlow: Phaser.GameObjects.Image | null = null;
  private lastCull = { x: Infinity, y: Infinity, zoom: 0 };
  /** Treasure chests by tile index. */
  private chests = new Map<number, Chest>();
  private levelTags = new Map<Unit, Phaser.GameObjects.Text>();
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
    this.map = new WorldMap(96, 96, (Math.random() * 1e9) | 0);
    buildAllTextures(this);

    const worldW = this.map.width * TILE;
    const worldH = this.map.height * TILE;
    for (const g of buildGround(this, this.map)) this.add.image(g.x, g.y, g.key).setOrigin(0, 0).setScale(1 / DENSITY).setDepth(-1e6);
    this.placeProps();

    this.fxGfx = this.add.graphics().setDepth(DEPTH_GROUND_FX);
    this.barGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);
    this.aimGfx = this.add.graphics().setDepth(DEPTH_OVERLAY - 1);

    this.hero = new Hero(this, this.map.spawn.x * TILE, this.map.spawn.y * TILE);
    this.units.push(this.hero);
    for (const spec of this.map.camps) this.spawnCamp(spec);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setBackgroundColor('#1f4a24');
    cam.setRoundPixels(true);
    this.userZoom = Phaser.Math.Clamp(Math.min(window.innerWidth, window.innerHeight) / 190, 2, 4);
    this.applyZoom();
    cam.centerOn(this.hero.x, this.hero.y);

    this.hud = new Hud(document.getElementById('ui')!, this.hero, this.map, portraitDataUrl(this), (frame) => this.itemIcon(frame), {
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
      usePotion: (id) => this.drink(id),
      equip: (i) => {
        const g = this.hero.inventory.slots[i];
        const err = this.hero.equipFromBag(i);
        if (err) this.hud.toast(err, 'warn');
        else if (g && g.kind === 'gear') this.hud.toast(`Equipped ${g.gear.name}`, 'good');
      },
      unequip: (slot: GearSlot) => {
        const err = this.hero.unequip(slot);
        if (err) this.hud.toast(err, 'warn');
      },
    });

    if (this.map.moonwell) {
      // The healing circle in front of the moonwell, where the hero starts.
      const w = this.map.moonwell;
      this.wellGlow = this.add
        .image(w.x * TILE, (w.y + 1.5) * TILE, ENV_ATLAS, 'fx_runes')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH_GROUND_FX + 1)
        .setAlpha(0.2);
      this.wellGlow.setScale(MOONWELL_GLYPH / this.wellGlow.width);
    }

    this.setupInput();
    this.scale.on('resize', () => this.applyZoom());
    this.hud.toast('Tap to move · tap enemies to attack · tap rocks to search them for potions', 'info');
  }

  // --- World construction -------------------------------------------------------------------

  /** One sprite per map prop (trees, rocks, ruins...), from the environment atlas at 2x density. */
  private placeProps(): void {
    for (const [anchor, p] of this.map.props) {
      const def = PROPS[p.key];
      const bottom = (p.ty + 1) * TILE;
      const img = this.add
        .image((p.tx + def.w / 2) * TILE, bottom + 1, ENV_ATLAS, p.key)
        .setOrigin(0.5, 1)
        .setScale(1 / DENSITY)
        .setDepth(bottom - 3);
      this.props.push(img);
      if (def.kind === 'rock') this.rocks.set(anchor, img);
    }
  }

  private spawnCamp(spec: CampSpec): void {
    const x = spec.x * TILE;
    const y = spec.y * TILE;
    const camp = new Camp(x, y);
    if (spec.treasure) {
      // The chest sits on the centre tile (which the map marks as blocked); guards stand around it.
      const tx = Math.floor(spec.x);
      const ty = Math.floor(spec.y);
      const img = this.add.image(x, (ty + 1) * TILE, 'chest').setOrigin(0.5, 1).setDepth((ty + 1) * TILE - 3);
      const glint = this.add.image(x + 3, y - 4, 'spark').setTint(0xfff2a8).setDepth(DEPTH_OVERLAY - 3).setAlpha(0);
      this.tweens.add({ targets: glint, alpha: 1, scale: 1.4, yoyo: true, repeat: -1, repeatDelay: 1400, duration: 260 });
      this.chests.set(ty * this.map.width + tx, { img, glint, camp, level: spec.level, opened: false });
    } else {
      this.add.image(x, y + 4, ENV_ATLAS, 'rubble').setOrigin(0.5, 1).setScale(0.28).setDepth(y + 3);
      const flame = this.add.image(x, y - 1, 'spark').setTint(0xff9a3a).setScale(2).setDepth(y + 5);
      this.tweens.add({ targets: flame, scaleX: 1.4, scaleY: 2.6, alpha: 0.7, yoyo: true, repeat: -1, duration: 220 });
    }
    const n = spec.members.length;
    spec.members.forEach((k, i) => {
      // A lone creep stands at the fire; packs spread around it. Alphas lead from the front (below).
      const a = (i / n) * Math.PI * 2 + 0.5;
      const r = n === 1 ? TILE * 0.9 : TILE * (n >= 4 ? 1.6 : 1.25);
      const lead = k === 'alphaBoar' && !spec.treasure;
      const px = lead ? x : x + Math.cos(a) * r;
      const py = lead ? y + TILE * 1.1 : y + Math.sin(a) * r;
      const c = new Creep(this, k, k === 'alphaBoar' ? spec.level + 1 : spec.level, camp, px, py);
      camp.creeps.push(c);
      this.units.push(c);
    });
    this.camps.push(camp);
  }

  // --- World interface ----------------------------------------------------------------------

  damage(target: Unit, amount: number, source: Unit | null, opts: DamageOpts = {}): void {
    if (target.dead) return;
    const isHero = target === this.hero;
    // Armour takes a flat amount off every hit on the hero; a hit always does at least 1.
    if (isHero && source) amount = Math.max(1, amount - this.hero.armor);
    target.hp -= amount;
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
          this.glyph('fx_burst', this.hero.x, this.hero.y - 12, 22, 1.2);
        }
      }
      this.hero.kills++;
      if (Math.random() < CREEP_POTION_DROP) this.giveLoot(target.x, target.y, Math.random() < 0.6 ? 'hp_potion' : 'mp_potion');
      // Gear scaled to the creep's level; alpha boars always carry something better.
      if (target.kind === 'alphaBoar') this.giveGear(target.x, target.y, rollGear(target.level, Math.random, 1, 1));
      else if (Math.random() < CREEP_GEAR_DROP) this.giveGear(target.x, target.y, rollGear(target.level));
      if (target.camp.cleared) target.camp.respawnT = 45;
    } else if (isHero) {
      this.hud.toast('Sylva has fallen!', 'warn');
      this.setTargeting(null);
      for (const c of this.camps) for (const u of c.creeps) if (!u.dead && !u.returning) u.issue({ type: 'idle' });
    }
  }

  searchRock(tx: number, ty: number): void {
    const key = ty * this.map.width + tx;
    const chest = this.chests.get(key);
    if (chest) {
      this.openChest(chest);
      return;
    }
    const img = this.rocks.get(key);
    if (!img || this.map.get(tx, ty) !== Tile.Rock) return;
    this.rocks.delete(key);
    this.props = this.props.filter((p) => p !== img);
    const def = PROPS[this.map.props.get(key)!.key];
    this.map.set(tx, ty, Tile.Grass);
    for (let dx = 0; dx < def.w; dx++) this.hud.clearMinimapTile(tx + dx, ty);
    const x = (tx + 0.5) * TILE;
    const y = (ty + 0.5) * TILE;
    this.burst(x, y, 0x9aa0ac, 12);
    this.tweens.add({ targets: img, alpha: 0, scaleY: 0.3, duration: 250, onComplete: () => img.destroy() });
    this.giveLoot(x, y, Math.random() < 0.65 ? 'hp_potion' : 'mp_potion');
  }

  private openChest(chest: Chest): void {
    if (chest.opened) return;
    if (!chest.camp.cleared) {
      this.hud.toast('The chest is guarded — defeat the guards first', 'warn');
      return;
    }
    chest.opened = true;
    chest.img.setTexture('chest_open');
    chest.glint.destroy();
    const x = chest.img.x;
    const y = chest.img.y - 8;
    this.burst(x, y, 0xffd84a, 20);
    const tome = TOME_IDS[Math.floor(Math.random() * TOME_IDS.length)];
    this.hud.toast(`Treasure! ${this.hero.readTome(tome)}`, 'good');
    this.floatText(x, y - 14, TOMES[tome].name, '#ffd84a', true);
    this.giveGear(x, y + 2, rollGear(chest.level, Math.random, 2, 1.5));
    this.time.delayedCall(250, () => this.giveLoot(x - 4, y, 'hp_potion'));
    this.time.delayedCall(500, () => this.giveLoot(x + 4, y, Math.random() < 0.5 ? 'hp_potion' : 'mp_potion'));
    const xp = 40 * chest.level;
    this.floatText(this.hero.x, this.hero.y - 34, `+${xp} xp`, '#c28cff');
    if (this.hero.gainXp(xp)) this.hud.toast(`Level ${this.hero.level}! New skill point`, 'good');
  }

  private readonly iconCache = new Map<string, string>();

  /** Item icon (a frame of the items atlas) as a data URL for the DOM HUD. */
  private itemIcon(frame: string): string {
    let url = this.iconCache.get(frame);
    if (!url) {
      url = frameDataUrl(this, 'items', frame, 2);
      this.iconCache.set(frame, url);
    }
    return url;
  }

  /** Drop a piece of gear into the bag, named and coloured by tier. */
  private giveGear(x: number, y: number, gear: Gear): void {
    if (this.hero.dead) return;
    const tier = TIERS[gear.tier];
    if (!this.hero.inventory.addGear(gear)) {
      this.hud.toast(`Bag full — ${gear.name} left behind`, 'warn');
      return;
    }
    this.floatText(x, y - 12, gear.name, tier.color, true);
    this.hud.toast(`Found ${gear.name} — open the bag to wear it`, gear.tier >= 3 ? 'good' : 'info');
    const colour = Phaser.Display.Color.HexStringToColor(tier.color).color;
    this.burst(x, y - 4, colour, 8);
    const icon = this.add.image(x, y - 6, 'spark').setTint(colour).setScale(2.5).setDepth(DEPTH_OVERLAY);
    this.tweens.add({ targets: icon, x: this.hero.x, y: this.hero.y - 10, duration: 350, ease: 'Quad.easeIn', onComplete: () => icon.destroy() });
  }

  /** Put a consumable in the hero's bag with a little pickup flourish. */
  private giveLoot(x: number, y: number, id: ItemId): void {
    if (this.hero.dead) return;
    const def = ITEMS[id];
    if (!this.hero.inventory.add(id)) {
      this.hud.toast(`Bag full — ${def.name} left behind`, 'warn');
      return;
    }
    this.floatText(x, y - 12, `+ ${def.name}`, id === 'hp_potion' ? '#ff8a8a' : '#8fb8ff', true);
    const icon = this.add.image(x, y - 6, 'spark').setTint(id === 'hp_potion' ? 0xff4a4a : 0x4a7aff).setScale(2).setDepth(DEPTH_OVERLAY);
    this.tweens.add({ targets: icon, x: this.hero.x, y: this.hero.y - 10, duration: 350, ease: 'Quad.easeIn', onComplete: () => icon.destroy() });
  }

  glyph(key: string, x: number, y: number, radius: number, duration: number): void {
    const img = this.add.image(x, y, ENV_ATLAS, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 1);
    img.setScale((radius * 2) / img.width).setAlpha(0);
    this.tweens.add({ targets: img, alpha: 0.9, duration: 250 });
    this.tweens.add({ targets: img, alpha: 0, delay: Math.max(0, duration * 1000 - 400), duration: 400, onComplete: () => img.destroy() });
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
      else if (k === 'escape') {
        if (this.hud.characterOpen) this.hud.toggleCharacter(false);
        else this.setTargeting(null);
      } else if (k === 'c' || k === 'i') this.hud.toggleCharacter();
      else if (k === '1') this.drink('hp_potion');
      else if (k === '2') this.drink('mp_potion');
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
      // A tap may wobble a little; only a real drag pans the camera (and turns off follow).
      if (!t.dragged && Math.hypot(p.x - t.startX, p.y - t.startY) > 20 * this.dpr) t.dragged = true;
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
    // Giving an order always brings the camera back to the hero.
    this.cameraLocked = true;
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

  /** Searchable rock or unopened chest under a world point (a little forgiving upwards). */
  private rockAt(x: number, y: number): { tx: number; ty: number } | null {
    for (const py of [y, y + 5]) {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(py / TILE);
      // Wide rocks: any footprint tile maps back to the prop's anchor.
      const anchor = this.map.propAt(tx, ty);
      const key = ty * this.map.width + tx;
      if (this.rocks.has(anchor)) return { tx: anchor % this.map.width, ty: Math.floor(anchor / this.map.width) };
      if (this.chests.has(key) && !this.chests.get(key)!.opened) return { tx, ty };
    }
    return null;
  }

  /** WC3 right-click: attack an enemy under the cursor, search a rock, otherwise move. */
  private smartOrder(x: number, y: number, queued: boolean): void {
    if (this.hero.dead) return;
    this.cameraLocked = true;
    const e = this.enemyAt(x, y);
    const rock = e ? null : this.rockAt(x, y);
    if (e) {
      this.hero.issue({ type: 'attack', target: e }, queued);
      this.addMarker(e.x, e.y, 0xff4a3a);
    } else if (rock) {
      this.hero.issue({ type: 'search', tx: rock.tx, ty: rock.ty }, queued);
      this.addMarker((rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE, 0xffd84a);
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
    if (cast && this.aim) {
      this.cameraLocked = true;
      this.castAt(i, this.aim.x, this.aim.y);
    }
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

  private drink(id: ItemId): void {
    const err = this.hero.usePotion(id);
    if (err) this.hud.toast(err, 'warn');
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
    this.updateMoonwell(dt);
    this.updateCamera(dt);
    this.cullProps();
    this.drawMarkers(dt);
    this.drawBars();
    this.drawAim();

    const cam = this.cameras.main;
    this.hud.update(this.units, { x: cam.worldView.x, y: cam.worldView.y, w: cam.worldView.width, h: cam.worldView.height }, this.cameraLocked);
  }

  /** Standing by the moonwell restores health and mana, like a Night Elf moon well. */
  private updateMoonwell(dt: number): void {
    const w = this.map.moonwell;
    const h = this.hero;
    if (!w || !this.wellGlow) return;
    const near = !h.dead && Math.hypot(h.x - w.x * TILE, h.y - (w.y + 1.5) * TILE) < MOONWELL_RADIUS;
    if (near) {
      h.hp = Math.min(h.maxHp, h.hp + 45 * dt);
      h.mana = Math.min(h.maxMana, h.mana + 25 * dt);
      if (Math.random() < dt * 6) this.burst(h.x + (Math.random() - 0.5) * 10, h.y - 4, 0x8fc8ff, 1);
    }
    const target = near ? 0.45 : 0.2 + Math.sin(this.time.now / 600) * 0.06;
    this.wellGlow.setAlpha(this.wellGlow.alpha + (target - this.wellGlow.alpha) * Math.min(1, dt * 4));
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

  private cullProps(): void {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const last = this.lastCull;
    if (Math.abs(v.x - last.x) < TILE && Math.abs(v.y - last.y) < TILE && cam.zoom === last.zoom) return;
    this.lastCull = { x: v.x, y: v.y, zoom: cam.zoom };
    // Sprites are anchored at their feet and can be ~110px wide and ~120px tall.
    const m = TILE * 4;
    for (const p of this.props) p.setVisible(p.x > v.x - m && p.x < v.right + m && p.y > v.y - TILE && p.y < v.bottom + TILE * 8);
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
      const tag = u instanceof Creep ? this.levelTag(u) : null;
      if (u.dead) continue;
      const s = u.stats.scale ?? 1;
      const w = Math.round(14 * s);
      const x = Math.round(u.x - w / 2);
      const y = Math.round(u.y - u.stats.barHeight * s);
      tag?.setPosition(x - 2, y + 1);
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

  /** Small level number next to a creep's health bar, coloured by how tough it is for the hero. */
  private levelTag(c: Creep): Phaser.GameObjects.Text {
    let t = this.levelTags.get(c);
    if (!t) {
      t = this.add
        .text(0, 0, `${c.level}`, { fontFamily: '"Press Start 2P", monospace', fontSize: '5px', stroke: '#1a1c2c', strokeThickness: 2 })
        .setOrigin(1, 0.5)
        .setResolution(4)
        .setDepth(DEPTH_OVERLAY + 1);
      this.levelTags.set(c, t);
    }
    const diff = c.level - this.hero.level;
    const color = diff >= 2 ? '#ff4a3a' : diff === 1 ? '#ffb03a' : diff === 0 ? '#ffd84a' : '#7dff6a';
    // setColor re-renders the text texture, so only touch it when the colour actually changes.
    if (t.getData('color') !== color) {
      t.setColor(color);
      t.setData('color', color);
    }
    t.setVisible(!c.dead);
    return t;
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
