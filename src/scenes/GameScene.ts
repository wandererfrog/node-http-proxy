import Phaser from 'phaser';
import { AuraName, buildAllTextures, frameDataUrl, iconDataUrl, portraitDataUrl } from '../art/sprites';
import { DENSITY, GroundChunk, buildGround } from '../art/ground';
import { ENV_ATLAS, PROPS, TOWN_ATLAS, propAtlas } from '../world/props';
import { ATLASES, IMAGES } from '../assets';
import { Ability } from '../abilities/Ability';
import { Camp, Creep } from '../entities/Creep';
import { CREEP_GEAR_DROP, CREEP_GOLD_DROP, CREEP_POTION_DROP, creepGold } from '../entities/balance';
import { GEAR_SLOTS, Gear, GearSlot, ITEMS, ItemId, TIERS, TOMES, TOME_IDS, gearValue, makeGear, rollGear, setGearTheme } from '../entities/items';
import { NPCS, NpcDef, NpcId, QUEST_BY_ID, QuestDef, QuestId, QuestLog } from '../entities/quests';
import type { StockItem } from '../ui/npcDialog';
import { Hero, HeroState } from '../entities/Hero';
import { CLASSES, ClassId } from '../entities/classes';
import { showClassPick } from '../ui/classPick';
import { TALENT_BY_ID } from '../entities/talents';
import { Arrow } from '../entities/Projectile';
import { DamageOpts, Unit, World } from '../entities/Unit';
import { Command, Hud } from '../ui/hud';
import { CampSpec, DUNGEON_NAMES, Portal, TILE, Tile, WorldMap } from '../world/map';

interface Chest {
  img: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
  camp: Camp;
  level: number;
  opened: boolean;
}

type Targeting = { kind: 'ability'; index: number } | { kind: 'attackMove' };

/** Where the scene builds: the overworld, or a floor of one of its dungeons. */
export type Destination =
  | { kind: 'overworld'; /** arriving back from this entrance's dungeon */ entrance?: number }
  | { kind: 'dungeon'; entrance: number; depth: number; level: number };

/** What scene.restart passes when travelling between maps (or starting a new game). */
export interface TravelData {
  to?: Destination;
  hero?: HeroState;
  newGame?: boolean;
  /** The class picked for a new game. */
  classId?: ClassId;
}

/** Lasts the whole run (kept in the game registry across map changes). */
interface RunState {
  /** The hero's class for this run. */
  classId: ClassId;
  worldSeed: number;
  /** Chests opened and rocks searched, as `${mapId}:${key}`, so they stay looted when you come back. */
  looted: Set<string>;
  /** Dungeon camps cleared, as `${mapId}:c${index}`: dungeon monsters never come back. */
  cleared: Set<string>;
  quests: QuestLog;
  /** Each vendor's wares, restocked whenever the hero's level changes. */
  stock: Partial<Record<NpcId, { level: number; items: StockItem[] }>>;
}

interface Villager {
  id: NpcId;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Text;
  mark: string;
}

const OVERWORLD_SIZE = 128;
const DUNGEON_W = 64;
const DUNGEON_H = 56;
/** Radius (world px) of the hero's own pool of light in a dungeon. */
const HERO_LIGHT = 64;
const DARKNESS = 0.88;
/** World px per texel of the darkness canvas (it's soft anyway, so it can be coarse and cheap). */
const DARK_RES = 2;

type MarkerKind = 'move' | 'attack' | 'search';

interface Marker {
  img: Phaser.GameObjects.Image;
  t: number;
  scale: number;
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
/** Ranger effects and auras (2x-density art, drawn at half size like the hero). */
const FX_ATLAS = 'rangerfx';
const AURA_ATLAS = 'auras';
const FX_SCALE = 0.5;
/** The cone indicator is pre-rotated to point along +x with its apex at the left middle; edges at ±20°. */
const CONE_HALF_SPREAD = (20 * Math.PI) / 180;
/** The AOE circle's rim spans this fraction of its frame (the rest is the tick marks around it). */
const AOE_RIM = 0.86;
/** How long an order marker shows (s). */
const MARKER_LIFE = 0.5;
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
  /** Ability aim indicators from the ranger FX sheet (hidden when not aiming). */
  private aimCone!: Phaser.GameObjects.Image;
  private aimLine!: Phaser.GameObjects.Image;
  private aimCircle!: Phaser.GameObjects.Image;
  /** Nature aura under the hero while the moonwell heals. */
  private wellAura!: Phaser.GameObjects.Sprite;
  /** The Trueshot Aura talent: the golden precision aura, always around the hero once learned. */
  /** The learned aura talent's aura (Trueshot, Brilliance, Devotion) around the hero. */
  private talentAura!: Phaser.GameObjects.Sprite;
  private talentAuraName: AuraName | null = null;
  private defendAura!: Phaser.GameObjects.Sprite;
  private bubble!: Phaser.GameObjects.Image;
  /** The light of the Knight's current move, drawn over him. */
  private moveFx!: Phaser.GameObjects.Sprite;
  private moveFxId = 0;

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

  create(data: TravelData = {}): void {
    this.resetState();
    this.dpr = (this.game.registry.get('dpr') as number) ?? 1;
    let run = this.registry.get('run') as RunState | undefined;
    if (!run || data.newGame) {
      // A new game starts with the class pick; the world is built once a hero is chosen.
      if (!data.classId) {
        this.showClassPick();
        return;
      }
      run = { classId: data.classId ?? 'ranger', worldSeed: (Math.random() * 1e9) | 0, looted: new Set(), cleared: new Set(), quests: new QuestLog(), stock: {} };
      this.registry.set('run', run);
    }
    this.run = run;
    setGearTheme(run.classId);
    const to: Destination = data.to ?? { kind: 'overworld' };
    this.dest = to;
    if (to.kind === 'dungeon') {
      // Each entrance's floors are fixed by the world seed: the same dungeon every visit (creeps come back).
      const seed = (run.worldSeed ^ Math.imul(to.entrance + 1, 0x9e3779b1) ^ Math.imul(to.depth, 0x85ebca6b)) >>> 0;
      this.map = new WorldMap(DUNGEON_W, DUNGEON_H, seed, { kind: 'dungeon', depth: to.depth, level: to.level });
      this.mapId = `d${to.entrance}-${to.depth}`;
    } else {
      this.map = new WorldMap(OVERWORLD_SIZE, OVERWORLD_SIZE, run.worldSeed);
      this.mapId = 'world';
    }
    // Rocks already searched on this map stay gone.
    for (const [anchor, p] of [...this.map.props]) if (PROPS[p.key].kind === 'rock' && run.looted.has(`${this.mapId}:r${anchor}`)) this.map.removeProp(anchor);
    if (!this.textures.exists('chest')) buildAllTextures(this);
    // The ranger effects are painted glows, not hard pixel art: filter them smoothly so the ones that
    // are stretched to an ability's size (the Volley cone, the rune circle) stay soft instead of blocky.
    for (const key of [FX_ATLAS, AURA_ATLAS]) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const worldW = this.map.width * TILE;
    const worldH = this.map.height * TILE;
    // Ground chunks are baked on demand: the ones around the start now, the rest as the camera nears them.
    this.groundPending = buildGround(this, this.map);
    this.placeProps();

    this.fxGfx = this.add.graphics().setDepth(DEPTH_GROUND_FX);
    this.barGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);
    this.aimGfx = this.add.graphics().setDepth(DEPTH_OVERLAY - 1);
    const aimImg = (frame: string, ox: number, oy: number) =>
      this.add.image(0, 0, FX_ATLAS, frame).setOrigin(ox, oy).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 2).setVisible(false);
    this.aimCone = aimImg('ground_cone', 0, 0.5);
    this.aimLine = aimImg('ground_line', 0, 0.5);
    this.aimCircle = aimImg('ground_aoe', 0.5, 0.5);
    this.wellAura = this.add.sprite(0, 0, AURA_ATLAS, 'aura_nature_ground_0').setScale(FX_SCALE).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(DEPTH_GROUND_FX + 2);
    this.wellAura.play('aura_nature');
    this.talentAura = this.add.sprite(0, 0, AURA_ATLAS, 'aura_precision_combined_0').setScale(FX_SCALE).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8).setDepth(DEPTH_GROUND_FX + 2).setVisible(false);
    this.talentAuraName = null;
    this.defendAura = this.add.sprite(0, 0, AURA_ATLAS, 'aura_focus_combined_0').setScale(FX_SCALE).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 3).setVisible(false);
    this.defendAura.play('aura_focus');
    // Arcane Shield: the bubble from the mage sheet, around the hero while it holds.
    this.bubble = this.add.image(0, 0, 'classfx', 'bubble_0').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.moveFx = this.add.sprite(0, 0, 'classfx', 'bash_0').setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setVisible(false);
    this.moveFxId = 0;

    // Arriving back from a dungeon: just outside its gate. Otherwise at the map's spawn.
    const back = to.kind === 'overworld' && to.entrance !== undefined ? this.map.portals.find((p) => p.kind === 'enter' && p.entrance === to.entrance) : undefined;
    const start = back ? { x: back.x, y: back.y + TILE * 2.2 } : { x: this.map.spawn.x * TILE, y: this.map.spawn.y * TILE };
    this.hero = new Hero(this, start.x, start.y, run.classId);
    if (data.hero) this.hero.restore(data.hero);
    this.units.push(this.hero);
    this.map.camps.forEach((spec, i) => this.spawnCamp(spec, i, this.map.kind === 'dungeon' && run.cleared.has(`${this.mapId}:c${i}`)));
    for (const [key, chest] of this.chests) {
      if (!run.looted.has(`${this.mapId}:${key}`)) continue;
      chest.opened = true;
      chest.img.setTexture('chest_open');
      chest.glint.destroy();
    }
    this.buildPortals();
    this.buildVillagers();
    if (this.map.kind === 'dungeon') this.buildDarkness();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setBackgroundColor(this.map.kind === 'dungeon' ? '#0a090d' : '#1f4a24');
    cam.fadeIn(350, 0, 0, 0);
    cam.setRoundPixels(true);
    this.userZoom = Phaser.Math.Clamp(Math.min(window.innerWidth, window.innerHeight) / 165, 2.3, 4.6);
    this.applyZoom();
    cam.centerOn(this.hero.x, this.hero.y);
    // The camera's worldView updates on its next render, so describe the first view around the hero.
    const vw = this.scale.width / cam.zoom;
    const vh = this.scale.height / cam.zoom;
    this.updateGround(Infinity, new Phaser.Geom.Rectangle(this.hero.x - vw / 2, this.hero.y - vh / 2, vw, vh));

    this.hud = new Hud(document.getElementById('ui')!, this.hero, this.map, portraitDataUrl(this, 4, this.hero.cls.texture), (frame) => this.itemIcon(frame), {
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
        else if (g) this.hud.toast(`Equipped ${g.gear.name}`, 'good');
      },
      unequip: (slot: GearSlot, to?: number) => {
        const err = this.hero.unequip(slot, to);
        if (err) this.hud.toast(err, 'warn');
      },
      moveBag: (from, to) => this.hero.inventory.move(from, to),
      learnTalent: (id) => {
        const def = TALENT_BY_ID[id];
        if (!this.hero.talents.learn(id)) return;
        this.hud.toast(`${def.name} — rank ${this.hero.talents.rank(id)}`, 'good');
        this.fxOnce('ground_buff', this.hero.x, this.hero.y + 1, { life: 0.8, scale: FX_SCALE * 0.6, grow: 0.7, follow: this.hero });
        if (def.aura && this.hero.talents.rank(id) === 1) this.auraOnce(def.aura, this.hero, 1.2);
      },
      resetTalents: () => {
        this.hero.talents.reset();
        this.hero.hp = Math.min(this.hero.hp, this.hero.maxHp);
        this.hud.toast('Talents reset: points refunded', 'info');
      },
      newGame: () => {
        document.querySelectorAll('#ui .hud').forEach((e) => e.remove());
        this.scene.restart({ newGame: true } satisfies TravelData);
      },
      questAccept: (id) => {
        if (!this.run.quests.accept(id)) return;
        const q = QUEST_BY_ID[id];
        this.hud.toast(`Quest accepted: ${q.title}`, 'good');
      },
      questComplete: (id) => this.completeQuest(id),
      buy: (i) => this.buy(i),
      sell: (i) => this.sell(i),
    }, run.quests);

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
    this.ready = true;
    const onResize = () => this.applyZoom();
    this.scale.on('resize', onResize);
    // The scene object is reused by restart: drop the global listener with the old map.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    if (to.kind === 'dungeon') {
      this.hud.toast(`${DUNGEON_NAMES[to.entrance % DUNGEON_NAMES.length]} — floor ${to.depth} (creep level ${to.level})`, 'good');
      if (to.depth === 1) this.hud.toast('The gate behind you leads back out. Find the rune portal to go deeper.', 'info');
    } else if (back) this.hud.toast('Back in the open air', 'info');
    else this.hud.toast('Tap to move · tap enemies to attack · tap villagers to talk', 'info');
    if (to.kind === 'dungeon') this.questProgress(run.quests.onDepth(to.depth));
    // A new ranger: the Elder greets them with the first quest of the intro.
    if (!data.hero && to.kind === 'overworld' && run.quests.active.size === 0 && run.quests.done.size === 0) {
      this.time.delayedCall(900, () => {
        if (!this.hud.dialogOpen && !this.hud.characterOpen) this.hud.openDialog(NPCS.elder, this.npcPortrait(NPCS.elder), [], 'arrival');
      });
    }
  }

  // --- Class pick ---------------------------------------------------------------------------

  /** True once create() has built a world (false while the class pick is up). */
  private ready = false;

  private showClassPick(): void {
    if (!this.textures.exists('chest')) buildAllTextures(this);
    this.cameras.main.setBackgroundColor('#0d0f16');
    const ui = document.getElementById('ui')!;
    ui.querySelectorAll('.hud, .class-pick').forEach((e) => e.remove());
    const pick = showClassPick(
      ui,
      (id) => portraitDataUrl(this, 4, CLASSES[id].texture),
      (frame) => (frame.includes(':') ? this.itemIcon(frame) : iconDataUrl(frame, 3)),
      (classId) => {
        pick.remove();
        this.scene.restart({ newGame: true, classId } satisfies TravelData);
      },
    );
    this.events.once('shutdown', () => pick.remove());
  }

  // --- Village, quests and trade ------------------------------------------------------------

  private villagers: Villager[] = [];

  /** The villagers stand on their (blocked) tiles with a name over their head and a quest marker. */
  private buildVillagers(): void {
    for (const n of this.map.npcs) {
      const def = NPCS[n.id];
      const x = (n.tx + 0.5) * TILE;
      const y = (n.ty + 1) * TILE - 2;
      this.add.image(x, y, 'shadow').setScale(0.7).setDepth(y - 1000);
      const sprite = this.add.image(x, y, TOWN_ATLAS, def.sprite).setOrigin(0.5, 1).setScale(1 / DENSITY).setDepth(y);
      const top = y - sprite.displayHeight;
      this.add
        .text(x, top - 1, def.name, { fontFamily: 'Pixelify Sans, monospace', fontSize: '16px', color: '#e8dcb5', stroke: '#000', strokeThickness: 4 })
        .setOrigin(0.5, 1)
        .setScale(0.3)
        .setResolution(3)
        .setDepth(DEPTH_OVERLAY - 4);
      const marker = this.add
        .text(x, top - 7, '', { fontFamily: 'Pixelify Sans, monospace', fontSize: '32px', color: '#ffd84a', stroke: '#2a1a00', strokeThickness: 6 })
        .setOrigin(0.5, 1)
        .setScale(0.3)
        .setResolution(3)
        .setDepth(DEPTH_OVERLAY - 4);
      this.villagers.push({ id: n.id, x, y, sprite, marker, mark: '' });
    }
    for (const g of this.map.guards) {
      const x = (g.tx + 0.5) * TILE;
      const y = (g.ty + 1) * TILE - 2;
      this.add.image(x, y, 'shadow').setScale(0.7).setDepth(y - 1000);
      this.add.image(x, y, TOWN_ATLAS, 'npc_guard').setOrigin(0.5, 1).setScale(1 / DENSITY).setDepth(y);
    }
    for (const f of this.map.townsfolk) {
      const x = (f.tx + 0.5) * TILE;
      const y = (f.ty + 0.5) * TILE;
      const shadow = this.add.image(x, y, 'shadow').setScale(0.6).setDepth(y - 1000);
      const sprite = this.add.image(x, y, TOWN_ATLAS, f.sprite).setOrigin(0.5, 1).setScale(1 / DENSITY).setDepth(y);
      this.townsfolk.push({ sprite, shadow, x, y, tx: x, ty: y, wait: 1 + Math.random() * 4, phase: Math.random() * 6 });
    }
  }

  private townsfolk: Array<{ sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; x: number; y: number; tx: number; ty: number; wait: number; phase: number }> = [];

  /**
   * Townsfolk stroll around the plaza: pause, pick a paved spot within a few tiles that they can
   * walk to in a straight line, walk there (a little bob for the steps), pause again.
   */
  private updateTownsfolk(dt: number): void {
    const map = this.map;
    const clear = (ax: number, ay: number, bx: number, by: number) => {
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 4);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const tx = Math.floor((ax + (bx - ax) * t) / TILE);
        const ty = Math.floor((ay + (by - ay) * t) / TILE);
        if (!map.isWalkable(tx, ty) || this.map.npcs.some((n) => n.tx === tx && n.ty === ty)) return false;
      }
      return true;
    };
    const cx = map.spawn.x * TILE;
    const cy = map.spawn.y * TILE;
    for (const f of this.townsfolk) {
      const d = Math.hypot(f.tx - f.x, f.ty - f.y);
      if (d < 0.5) {
        f.wait -= dt;
        if (f.wait <= 0) {
          for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = (2 + Math.random() * 4) * TILE;
            let nx = f.x + Math.cos(a) * r;
            let ny = f.y + Math.sin(a) * r;
            // Stay in the village.
            if (Math.hypot(nx - cx, ny - cy) > 11 * TILE) {
              nx = (f.x + cx) / 2;
              ny = (f.y + cy) / 2 + TILE;
            }
            if (map.get(Math.floor(nx / TILE), Math.floor(ny / TILE)) !== Tile.Paved || !clear(f.x, f.y, nx, ny)) continue;
            f.tx = nx;
            f.ty = ny;
            break;
          }
          f.wait = 2 + Math.random() * 5;
        }
        f.sprite.setPosition(Math.round(f.x), Math.round(f.y));
      } else {
        const step = Math.min(d, 13 * dt);
        f.x += ((f.tx - f.x) / d) * step;
        f.y += ((f.ty - f.y) / d) * step;
        f.phase += dt * 9;
        if (Math.abs(f.tx - f.x) > 0.5) f.sprite.setFlipX(f.tx < f.x);
        f.sprite.setPosition(Math.round(f.x), Math.round(f.y - Math.abs(Math.sin(f.phase)) * 1.2));
      }
      f.shadow.setPosition(Math.round(f.x), Math.round(f.y + 1));
      f.sprite.setDepth(f.y);
    }
  }

  /** Gold ! for a new quest, gold ? to hand one in, grey ? while it's under way. */
  private updateVillagers(): void {
    const t = this.time.now / 1000;
    for (const v of this.villagers) {
      const m = this.run.quests.marker(v.id);
      const mark = m === 'available' ? '!' : m ? '?' : '';
      if (mark !== v.mark || (m === 'progress') !== (v.marker.style.color === '#9a9a9a')) {
        v.mark = mark;
        v.marker.setText(mark).setColor(m === 'progress' ? '#9a9a9a' : '#ffd84a');
      }
      v.marker.setY(v.y - v.sprite.displayHeight - 7 + Math.round(Math.sin(t * 3 + v.x) * 1.5));
    }
  }

  /** The villager under a world point (generous, like enemies). */
  private villagerAt(x: number, y: number): Villager | null {
    const slop = 10 / (this.cameras.main.zoom / this.dpr) + 4;
    let best: Villager | null = null;
    let bestD = Infinity;
    for (const v of this.villagers) {
      const d = Math.hypot(v.x - x, v.y - 8 - y);
      if (d < 7 + slop && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  /** The hero reached a villager (the `talk` order): open their dialog. */
  talkTo(tx: number, ty: number): void {
    const n = this.map.npcs.find((v) => v.tx === tx && v.ty === ty);
    if (!n) return;
    const def = NPCS[n.id];
    this.tradingWith = def.vendor ? n.id : null;
    // Arriving with a talk quest for this villager hands it in straight away.
    const ready = this.run.quests.handInsAt(n.id).find((q) => q.objective.kind === 'talk');
    this.hud.openDialog(def, this.npcPortrait(def), def.vendor ? this.stock(def) : [], ready?.id);
  }

  /** A villager's face for the dialog: their sprite, big and crisp. */
  private npcPortrait(def: NpcDef): string {
    return frameDataUrl(this, TOWN_ATLAS, def.sprite, 4);
  }

  private tradingWith: NpcId | null = null;

  /**
   * A vendor's wares at the hero's level. Tamsin: potions and trinkets (rings, amulets, cloaks,
   * quivers). Brann: bows and armour. Gear is priced at four times what they'd pay for it.
   */
  private stock(def: NpcDef): StockItem[] {
    const s = this.run.stock[def.id];
    if (s && s.level === this.hero.level) return s.items;
    const items: StockItem[] = [];
    const slots: GearSlot[] = def.vendor === 'smith' ? ['bow', 'helmet', 'chest', 'gloves', 'boots'] : ['ring', 'amulet', 'cloak', 'quiver'];
    if (def.vendor === 'goods') {
      items.push({ kind: 'potion', id: 'hp_potion', price: 15 }, { kind: 'potion', id: 'mp_potion', price: 20 });
    }
    const n = def.vendor === 'smith' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const gear = rollGear(this.hero.level, Math.random, 0, 0.5, slots);
      items.push({ kind: 'gear', gear, price: gearValue(gear) * 4 });
    }
    this.run.stock[def.id] = { level: this.hero.level, items };
    return items;
  }

  private buy(i: number): void {
    const stock = this.tradingWith ? this.run.stock[this.tradingWith]?.items : undefined;
    const item = stock?.[i];
    const h = this.hero;
    if (!stock || !item) return;
    if (h.gold < item.price) {
      this.hud.toast('Not enough gold', 'warn');
      return;
    }
    if (item.kind === 'potion') {
      if (!h.inventory.add(item.id)) {
        this.hud.toast(`${ITEMS[item.id].name}s are full`, 'warn');
        return;
      }
      this.hud.toast(`Bought ${ITEMS[item.id].name}`, 'info');
    } else {
      if (!h.inventory.addGear(item.gear)) {
        this.hud.toast('Bag is full', 'warn');
        return;
      }
      stock.splice(i, 1);
      this.hud.setStock(stock);
      this.hud.toast(`Bought ${item.gear.name}`, 'good');
    }
    h.gold -= item.price;
  }

  private sell(i: number): void {
    const slot = this.hero.inventory.slots[i];
    if (!slot) return;
    const value = gearValue(slot.gear);
    this.hero.inventory.slots[i] = null;
    this.hero.gold += value;
    this.hud.toast(`Sold ${slot.gear.name} for ${value}g`, 'info');
  }

  private completeQuest(id: QuestId): void {
    const r = this.run.quests.complete(id);
    if (!r) return;
    const h = this.hero;
    const q = QUEST_BY_ID[id];
    this.hud.toast(`Quest complete: ${q.title}`, 'good');
    this.floatText(h.x, h.y - 34, `+${r.xp} xp`, '#c28cff', true);
    if (h.gainXp(r.xp)) this.onLevelUp();
    this.giveGold(h.x, h.y - 20, r.gold);
    for (let k = 0; k < (r.potions ?? 0); k++) this.time.delayedCall(200 * k, () => this.giveLoot(h.x, h.y, 'hp_potion'));
    if (r.gear) {
      const slot = r.gear.slot ?? GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
      this.giveGear(h.x, h.y, makeGear(slot, r.gear.tier, h.level));
    }
    if (r.tome) this.hud.toast(h.readTome(r.tome), 'good');
    this.auraOnce('precision', h, 1.2);
  }

  /** Quest objectives moved: a toast per step, and a louder one when one is done. */
  private questProgress(moved: QuestDef[]): void {
    for (const q of moved) {
      const log = this.run.quests;
      if (log.isComplete(q.id)) this.hud.toast(`${q.title}: done! Return to ${NPCS[q.turnIn].name}`, 'good');
      else this.hud.toast(`${q.title}: ${log.status(q.id)}`, 'info');
    }
  }

  // --- Maps and travel ----------------------------------------------------------------------

  private run!: RunState;
  private dest: Destination = { kind: 'overworld' };
  /** Key for this map in the run's looted set. */
  private mapId = 'world';
  private travelling = false;
  /** A portal only fires once you've stood off every doorway (no bouncing straight back). */
  private portalArmed = false;
  private darkness: Phaser.GameObjects.Image | null = null;
  private darkTex: Phaser.Textures.CanvasTexture | null = null;
  private lightGlows: Array<{ img: Phaser.GameObjects.Image; radius: number; phase: number; flicker: boolean }> = [];

  private groundPending: GroundChunk[] = [];

  /**
   * Bake ground chunks that are in (or within a chunk of) the camera view, nearest first: up to
   * `budget` of them (all of them at the start, one per frame while walking).
   */
  private updateGround(budget = 1, view?: Phaser.Geom.Rectangle): void {
    if (this.groundPending.length === 0) return;
    const v = view ?? this.cameras.main.worldView;
    const margin = TILE * 16;
    const cx = v.centerX;
    const cy = v.centerY;
    const near = this.groundPending
      .filter((c) => c.x < v.right + margin && c.x + c.w > v.x - margin && c.y < v.bottom + margin && c.y + c.h > v.y - margin)
      .sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy));
    for (const c of near.slice(0, budget)) {
      c.build();
      this.add.image(c.x, c.y, c.key).setOrigin(0, 0).setScale(1 / DENSITY).setDepth(-1e6);
      this.groundPending.splice(this.groundPending.indexOf(c), 1);
    }
  }

  /** The scene object survives restart: clear everything the last map left behind. */
  private resetState(): void {
    this.ready = false;
    this.units = [];
    this.camps = [];
    this.rocks = new Map();
    this.props = [];
    this.wellGlow = null;
    this.lastCull = { x: Infinity, y: Infinity, zoom: 0 };
    this.chests = new Map();
    this.villagers = [];
    this.townsfolk = [];
    this.levelTags = new Map();
    this.arrows = [];
    this.markers = [];
    this.followers = [];
    this.targeting = null;
    this.aim = null;
    this.buttonAim = null;
    this.cameraLocked = true;
    this.touches = new Map();
    this.pinch = null;
    this.gestureUsed = false;
    this.travelling = false;
    this.portalArmed = false;
    this.darkness = null;
    this.darkTex = null;
    this.lightGlows = [];
  }

  /** Doorway effects: a swirling wind aura in gate openings, a pulsing rune circle for the way down. */
  private buildPortals(): void {
    for (const p of this.map.portals) {
      if (p.kind === 'down') {
        const ring = this.add.image(p.x, p.y, FX_ATLAS, 'ground_aoe').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 2).setTint(0xc89aff);
        ring.setScale((TILE * 2.6) / ring.width);
        this.tweens.add({ targets: ring, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: ring, angle: 360, duration: 12000, repeat: -1 });
        const swirl = this.add.sprite(p.x, p.y, AURA_ATLAS).setScale(FX_SCALE).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 3);
        swirl.play('aura_focus');
        if (this.map.kind === 'dungeon') this.map.lights.push({ x: p.x, y: p.y, color: 0xb08aff, radius: 50 });
        continue;
      }
      // Gate doorway: dark void with a swirl in it.
      const swirl = this.add.sprite(p.x, p.y - 2, AURA_ATLAS).setScale(FX_SCALE * 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(p.y + 1).setAlpha(0.9);
      swirl.play('aura_wind');
      if (p.kind === 'enter') {
        const name = DUNGEON_NAMES[(p.entrance ?? 0) % DUNGEON_NAMES.length];
        this.add
          .text(p.x, p.y - TILE * 3.6, `${name}\nlevel ${p.level}`, { fontFamily: 'Pixelify Sans, monospace', fontSize: '16px', color: '#ffd84a', align: 'center', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5, 1)
          .setScale(0.32)
          .setResolution(3)
          .setDepth(DEPTH_OVERLAY - 4);
      }
    }
  }

  /**
   * Dungeon darkness: a small canvas over the camera view (half world resolution, smoothed when
   * scaled up), filled dark each frame with soft holes cut around the hero, torches, crystals and
   * the portal. Coloured additive glows tint the lit pools.
   */
  private buildDarkness(): void {
    if (!this.textures.exists('light_brush')) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this.textures.addCanvas('light_brush', c);
    }
    const tex = this.textures.exists('darkness')
      ? (this.textures.get('darkness') as Phaser.Textures.CanvasTexture)
      : this.textures.createCanvas('darkness', 64, 64)!;
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.darkTex = tex;
    this.darkness = this.add.image(0, 0, 'darkness').setOrigin(0, 0).setScale(DARK_RES).setDepth(DEPTH_OVERLAY - 20);
    for (const l of this.map.lights) {
      const img = this.add.image(l.x, l.y, 'light_brush').setTint(l.color).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3).setDepth(DEPTH_OVERLAY - 21);
      img.setScale((l.radius * 2) / 128);
      this.lightGlows.push({ img, radius: l.radius, phase: Math.random() * 10, flicker: l.color === 0xffa040 });
    }
  }

  private updateDarkness(): void {
    const tex = this.darkTex;
    const img = this.darkness;
    if (!tex || !img) return;
    const v = this.cameras.main.worldView;
    const w = Math.ceil(v.width / DARK_RES) + 2;
    const h = Math.ceil(v.height / DARK_RES) + 2;
    if (tex.width !== w || tex.height !== h) tex.setSize(w, h);
    const ox = Math.floor(v.x / DARK_RES) * DARK_RES;
    const oy = Math.floor(v.y / DARK_RES) * DARK_RES;
    img.setPosition(ox, oy);
    const ctx = tex.context;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(4, 3, 8, ${DARKNESS})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const t = this.time.now / 1000;
    // Cut a soft round hole of radius `r` (world px) out of the darkness.
    const hole = (x: number, y: number, r: number) => {
      if (x + r < v.x || x - r > v.x + v.width || y + r < v.y || y - r > v.y + v.height) return;
      const cx = (x - ox) / DARK_RES;
      const cy = (y - oy) / DARK_RES;
      const cr = r / DARK_RES;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    };
    if (!this.hero.dead) hole(this.hero.x, this.hero.y - 6, HERO_LIGHT);
    for (const g of this.lightGlows) {
      const f = g.flicker ? 1 + Math.sin(t * 9 + g.phase) * 0.05 + Math.sin(t * 23 + g.phase) * 0.03 : 1;
      g.img.setScale((g.radius * 2 * f) / 128);
      hole(g.img.x, g.img.y, g.radius * f);
    }
    tex.refresh();
  }

  /** Walked into a doorway? Then go where it leads. */
  private checkPortals(): void {
    if (this.travelling || this.hero.dead) return;
    const p = this.map.portalAt(Math.floor(this.hero.x / TILE), Math.floor(this.hero.y / TILE));
    if (!p) {
      this.portalArmed = true;
      return;
    }
    if (this.portalArmed) this.travel(p);
  }

  private travel(p: Portal): void {
    const cur = this.dest;
    let to: Destination;
    if (p.kind === 'enter') to = { kind: 'dungeon', entrance: p.entrance ?? 0, depth: 1, level: p.level ?? 2 };
    else if (p.kind === 'down' && cur.kind === 'dungeon') to = { kind: 'dungeon', entrance: cur.entrance, depth: cur.depth + 1, level: cur.level + 1 };
    else to = { kind: 'overworld', entrance: cur.kind === 'dungeon' ? cur.entrance : undefined };
    this.travelling = true;
    this.setTargeting(null);
    this.hud.toggleCharacter(false);
    this.hero.stop();
    const hero = this.hero.snapshot();
    const cam = this.cameras.main;
    cam.fadeOut(300, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      document.querySelectorAll('#ui .hud').forEach((e) => e.remove());
      this.scene.restart({ to, hero } satisfies TravelData);
    });
  }

  // --- World construction -------------------------------------------------------------------

  /** One sprite per map prop (trees, rocks, ruins...), from the environment atlas at 2x density. */
  private placeProps(): void {
    for (const [anchor, p] of this.map.props) {
      const def = PROPS[p.key];
      const bottom = (p.ty + 1) * TILE;
      const img = this.add
        .image((p.tx + def.w / 2) * TILE, bottom + 1, propAtlas(p.key), p.key)
        .setOrigin(0.5, 1)
        .setScale(1 / DENSITY)
        .setDepth(bottom - 3);
      this.props.push(img);
      if (def.kind === 'rock') this.rocks.set(anchor, img);
    }
  }

  /** A camp and its creeps; `cleared` (dungeon camps already beaten this run) spawns no creeps. */
  private spawnCamp(spec: CampSpec, index: number, cleared = false): void {
    const x = spec.x * TILE;
    const y = spec.y * TILE;
    const camp = new Camp(x, y);
    camp.index = index;
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
    if (cleared) {
      this.camps.push(camp);
      return;
    }
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
    if (isHero && source) {
      amount = Math.max(1, amount - this.hero.armor);
      // Defender takes a share off; the Arcane Shield soaks what's left (and may soak it all).
      const before = amount;
      amount = this.hero.mitigate(amount);
      if (amount <= 0) {
        this.floatText(target.x, target.y - 18, `(${Math.round(before)})`, '#8fc8ff');
        return;
      }
    }
    target.hp -= amount;
    this.floatText(target.x, target.y - 18, `${Math.round(amount)}`, isHero ? '#ff6a5a' : (opts.color ?? '#ffffff'), opts.big);
    target.onDamaged(source);
    if (target.hp > 0) return;
    target.hp = 0;
    target.die();
    if (target instanceof Creep) {
      this.burst(target.x, target.y - 6, 0xff4a3a, 4);
      this.fxOnce('ground_death_1', target.x, target.y + 2, { life: 0.9, scale: FX_SCALE * (target.stats.scale ?? 1), originY: 0.75, grow: 0.15 });
      if (!this.hero.dead) {
        this.floatText(this.hero.x, this.hero.y - 26, `+${target.xpValue} xp`, '#c28cff');
        if (this.hero.gainXp(target.xpValue)) this.onLevelUp();
      }
      this.hero.kills++;
      this.questProgress(this.run.quests.onKill(target.kind));
      if (Math.random() < CREEP_POTION_DROP) this.giveLoot(target.x, target.y, Math.random() < 0.6 ? 'hp_potion' : 'mp_potion');
      if (Math.random() < CREEP_GOLD_DROP || target.kind === 'alphaBoar') this.giveGold(target.x, target.y - 4, creepGold(target.level) * (target.kind === 'alphaBoar' ? 4 : 1));
      // Gear scaled to the creep's level; alpha boars always carry something better.
      if (target.kind === 'alphaBoar') this.giveGear(target.x, target.y, rollGear(target.level, Math.random, 1, 1));
      else if (Math.random() < CREEP_GEAR_DROP) this.giveGear(target.x, target.y, rollGear(target.level));
      if (target.camp.cleared) {
        // Overworld camps come back after a while; dungeon monsters stay dead for the run.
        if (this.map.kind === 'dungeon') {
          this.run.cleared.add(`${this.mapId}:c${target.camp.index}`);
          if (this.map.camps[target.camp.index]?.treasure) this.questProgress(this.run.quests.onDungeonBoss());
        } else target.camp.respawnT = 45;
      }
    } else if (isHero) {
      this.hud.toast(`${this.hero.cls.hero} has fallen!`, 'warn');
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
    this.run.looted.add(`${this.mapId}:r${key}`);
    this.props = this.props.filter((p) => p !== img);
    const def = PROPS[this.map.props.get(key)!.key];
    this.map.set(tx, ty, this.map.groundTile);
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
    for (const [k, c] of this.chests) if (c === chest) this.run.looted.add(`${this.mapId}:${k}`);
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
    if (this.hero.gainXp(xp)) this.onLevelUp();
    this.giveGold(x, y - 6, 15 * chest.level);
  }

  private readonly iconCache = new Map<string, string>();

  /**
   * An icon as a data URL for the DOM HUD: a frame of the items atlas by default, `atlas:frame` for
   * another atlas, or `ability:name` for an ability icon (talents use all three).
   */
  private itemIcon(frame: string): string {
    let url = this.iconCache.get(frame);
    if (!url) {
      const [atlas, name] = frame.includes(':') ? frame.split(':') : ['items', frame];
      url = atlas === 'ability' ? iconDataUrl(name, 3) : frameDataUrl(this, atlas, name, 2);
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

  /** Put a potion on the hero's belt (the 1 / 2 buttons, not the bag) with a little pickup flourish. */
  private giveLoot(x: number, y: number, id: ItemId): void {
    if (this.hero.dead) return;
    const def = ITEMS[id];
    if (!this.hero.inventory.add(id)) {
      this.hud.toast(`${def.name}s are full (${def.maxStack}) — left behind`, 'warn');
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

  fireArrow(from: Unit, target: Unit, damage: number, fire: boolean, crit = false): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'homing', target, fire, crit }));
  }

  fireMagicBolt(from: Unit, target: Unit, damage: number, crit = false): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'bolt', target, crit }));
  }

  fireArcaneBolt(from: Unit, target: Unit, damage: number, crit = false): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'arcane', target, crit }));
  }

  fireOrb(from: Unit, angle: number, range: number, damage: number): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'orb', angle, range }));
  }

  spellFx(anim: string, x: number, y: number, opts: { width?: number; scale?: number; originY?: number; delay?: number } = {}): void {
    const play = () => {
      const s = this.add.sprite(x, y, 'classfx').setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, opts.originY ?? 0.5).setDepth(y + 4);
      s.play(anim);
      const f = s.frame;
      s.setScale(opts.scale ?? (opts.width ? opts.width / Math.max(1, f.width) : 0.5));
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.tweens.add({ targets: s, alpha: 0, duration: 220, onComplete: () => s.destroy() }));
    };
    if (opts.delay) this.time.delayedCall(opts.delay, play);
    else play();
  }

  /** The hero's lasting buffs: the talent aura, Defender's blue ring and the Arcane Shield bubble. */
  private updateHeroBuffs(): void {
    const h = this.hero;
    const aura = h.dead ? null : h.aura;
    if (aura !== this.talentAuraName) {
      this.talentAuraName = aura;
      if (aura) this.talentAura.play(`aura_${aura}`);
    }
    this.talentAura.setVisible(!!aura).setPosition(h.x, h.y + 1);
    this.defendAura.setVisible(h.defendT > 0 && !h.dead).setPosition(h.x, h.y + 1);
    const mv = h.move;
    if (mv && mv.anim && !h.dead) {
      if (mv.id !== this.moveFxId) {
        this.moveFxId = mv.id;
        this.moveFx.setVisible(true).play(mv.anim);
      }
      // Frames are pinned at the knight's feet; bash and leap face the way he swings.
      this.moveFx.setPosition(Math.round(h.x), Math.round(h.y + 2)).setDepth(h.y + 2);
      this.moveFx.setFlipX(mv.pose === 'swing' && Math.cos(h.angle) < -0.2);
    } else if (this.moveFx.visible) this.moveFx.setVisible(false).anims.stop();
    const shielded = h.absorbT > 0 && !h.dead;
    this.bubble.setVisible(shielded);
    if (shielded) {
      const pulse = 1 + Math.sin(this.time.now / 180) * 0.04;
      this.bubble.setPosition(h.x, h.y - 9).setScale((30 / this.bubble.width) * pulse).setDepth(h.y + 2);
      this.bubble.setAlpha(Math.min(1, 0.55 + h.absorbT / 6) * (h.absorbT < 2 ? 0.5 + 0.5 * Math.sin(this.time.now / 60) : 1));
    }
  }

  fireVolleyArrow(from: Unit, angle: number, range: number, damage: number): void {
    this.arrows.push(new Arrow(this, from, damage, { kind: 'linear', angle, range }));
  }

  enemiesInRadius(of: Unit, x: number, y: number, r: number): Unit[] {
    return this.units.filter((u) => !u.dead && of.isEnemy(u) && Math.hypot(u.x - x, u.y - y) <= r + u.stats.radius);
  }

  /**
   * Rain of Arrows: the rune circle from the concept sheet (the same "AOE circle" the aim showed),
   * sized so its rim is exactly the area. It lands, then pulses while the hero channels in the focus aura.
   */
  skyMark(x: number, y: number, radius: number, duration: number): void {
    const mark = this.add.image(x, y, FX_ATLAS, 'ground_aoe').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 2).setAlpha(0);
    const scale = (radius * 2) / (mark.width * AOE_RIM);
    mark.setScale(scale * 1.5);
    this.tweens.add({ targets: mark, scale, alpha: 1, duration: 380, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: mark, alpha: 0.7, delay: 400, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.time.delayedCall(Math.max(0, duration * 1000 - 350), () => {
      this.tweens.killTweensOf(mark);
      this.tweens.add({ targets: mark, alpha: 0, duration: 350, onComplete: () => mark.destroy() });
    });
    this.auraOnce('focus', this.hero, duration);
  }

  /** One arrow falling from the sky: the basic arrow turned to point down, landing in the rain impact. */
  private skyArrow(gx: number, gy: number, delay: number, track?: Unit, onLand?: () => void): void {
    this.time.delayedCall(delay, () => {
      const start = { x: gx, y: gy };
      const arrow = this.add.image(gx, gy - 90, FX_ATLAS, 'arrow_basic').setOrigin(1, 0.5).setRotation(Math.PI / 2).setScale(0.6, 0.5).setDepth(gy + 2);
      const prog = { t: 0 };
      this.tweens.add({
        targets: prog,
        t: 1,
        duration: 240,
        ease: 'Quad.easeIn',
        onUpdate: () => {
          // Arrows aimed at an enemy land where the enemy is when they land (they track a little).
          const tx = track && !track.dead ? track.x : start.x;
          const ty = track && !track.dead ? track.y : start.y;
          arrow.setPosition(tx, ty - 90 + 92 * prog.t).setDepth(ty + 2);
        },
        onComplete: () => {
          const hx = arrow.x;
          const hy = arrow.y - 2;
          arrow.destroy();
          const hit = this.add.image(hx, hy, FX_ATLAS, 'ground_rainhit').setOrigin(0.5, 0.8).setScale(FX_SCALE * 0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(hy + 1);
          this.tweens.add({ targets: hit, alpha: 0, delay: 120, duration: 260, onComplete: () => hit.destroy() });
          onLand?.();
        },
      });
    });
  }

  skyVolley(x: number, y: number, radius: number, targets: Unit[], extra: number, onLand: (u: Unit) => void): void {
    for (const u of targets) this.skyArrow(u.x, u.y, Math.random() * 90, u, () => onLand(u));
    for (let i = 0; i < extra; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.85;
      this.skyArrow(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.random() * 120);
    }
  }

  volleyBurst(x: number, y: number, angle: number): void {
    // The multi-shot fan points right in the art, with the bow end at its left edge.
    const fan = this.add.image(x + Math.cos(angle) * 4, y - 7 + Math.sin(angle) * 4, FX_ATLAS, 'multishot_flight')
      .setOrigin(0.05, 0.5)
      .setRotation(angle)
      .setScale(FX_SCALE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(y + 8);
    this.tweens.add({ targets: fan, alpha: 0, scaleX: FX_SCALE * 1.4, duration: 280, ease: 'Quad.easeOut', onComplete: () => fan.destroy() });
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
        if (this.hud.dialogOpen) this.hud.closeDialog();
        else if (this.hud.characterOpen) this.hud.toggleCharacter(false);
        else this.setTargeting(null);
      } else if (k === 'c' || k === 'i') this.hud.toggleCharacter();
      else if (k === 'n') this.hud.toggleTalents();
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
      // A cancelled touch (the OS took it, e.g. an edge swipe) is not a tap.
      if (t.dragged || wasGesture || p.wasCanceled) return;
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
        this.addMarker(x, y, 'attack');
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
    const npc = e ? null : this.villagerAt(x, y);
    const rock = e || npc ? null : this.rockAt(x, y);
    if (npc) {
      const n = this.map.npcs.find((v) => v.id === npc.id)!;
      this.hero.issue({ type: 'talk', tx: n.tx, ty: n.ty }, queued);
      this.addMarker(npc.x, npc.y, 'search');
    } else if (e) {
      this.hero.issue({ type: 'attack', target: e }, queued);
      this.addMarker(e.x, e.y, 'attack');
    } else if (rock) {
      this.hero.issue({ type: 'search', tx: rock.tx, ty: rock.ty }, queued);
      this.addMarker((rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE, 'search');
    } else {
      this.hero.issue({ type: 'move', x, y }, queued);
      this.addMarker(x, y, 'move');
    }
  }

  private castAt(i: number, x: number, y: number, queued = false): void {
    const err = this.hero.useAbility(this.hero.abilities[i], x, y, queued);
    if (err) this.hud.toast(err, 'warn');
    else this.addMarker(x, y, 'search');
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
    if (ab.targeting === 'self') {
      // Frost Nova, Whirlwind, Defender...: no aiming, it happens around the hero.
      this.setTargeting(null);
      this.cameraLocked = true;
      const err = this.hero.useAbility(ab, this.hero.x, this.hero.y);
      if (err) this.hud.toast(err, 'warn');
      return;
    }
    if (this.targeting?.kind === 'ability' && this.targeting.index === i) this.setTargeting(null);
    else this.setTargeting({ kind: 'ability', index: i });
  }

  private onAbilityAim(i: number, dx: number, dy: number): void {
    const ab = this.hero.abilities[i];
    if (ab.blocked(this.hero) || ab.targeting !== 'point') return;
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
    const before = this.hero.inventory.count(id);
    const err = this.hero.usePotion(id);
    if (err) this.hud.toast(err, 'warn');
    else if (this.hero.inventory.count(id) < before) {
      if (id === 'hp_potion') this.fxOnce('ground_heal', this.hero.x, this.hero.y + 2, { life: 0.9, originY: 0.7, follow: this.hero });
      else this.auraOnce('focus', this.hero, 1.2);
    }
  }

  private learn(i: number): void {
    const ab = this.hero.abilities[i];
    if (this.hero.learn(ab)) {
      this.hud.toast(`${ab.name} — level ${ab.level}`, 'good');
      this.fxOnce('ground_buff', this.hero.x, this.hero.y + 1, { life: 0.8, scale: FX_SCALE * 0.6, grow: 0.7, follow: this.hero });
    } else if (this.hero.skillPoints === 0) this.hud.toast('No skill points', 'warn');
    else if (ab.level >= ab.maxLevel) this.hud.toast('Already at max level', 'warn');
    else this.hud.toast(`Requires hero level ${ab.requiredHeroLevel(ab.level + 1)}`, 'warn');
  }

  /** WC3-style order marker that shrinks and fades: blue target (move), red runes (attack), gold (search/cast). */
  private addMarker(x: number, y: number, kind: MarkerKind): void {
    const [atlas, frame, scale] =
      kind === 'move' ? [FX_ATLAS, 'ground_target', 0.36] : kind === 'attack' ? [FX_ATLAS, 'ground_debuff', 0.42] : [AURA_ATLAS, 'aura_precision_ground_10', 0.4];
    const img = this.add.image(x, y, atlas, frame).setScale(scale).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 3);
    this.markers.push({ img, t: 0, scale });
  }

  private followers: Array<{ obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite; unit: Unit; dy: number }> = [];

  /**
   * One-shot additive effect from the ranger FX atlas at (x, y): fades in fast, holds, fades out over
   * `life` seconds. `grow` scales it up by that fraction over its life; `follow` keeps it on a unit.
   */
  private fxOnce(
    frame: string,
    x: number,
    y: number,
    o: { life?: number; scale?: number; originY?: number; grow?: number; follow?: Unit; depth?: number } = {},
  ): Phaser.GameObjects.Image {
    const life = o.life ?? 0.8;
    const scale = o.scale ?? FX_SCALE;
    const img = this.add
      .image(x, y, FX_ATLAS, frame)
      .setOrigin(0.5, o.originY ?? 0.5)
      .setScale(scale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(o.depth ?? DEPTH_GROUND_FX + 4)
      .setAlpha(0);
    this.tweens.add({ targets: img, alpha: 1, duration: 90 });
    this.tweens.add({ targets: img, alpha: 0, delay: life * 550, duration: life * 450, onComplete: () => img.destroy() });
    if (o.grow) this.tweens.add({ targets: img, scale: scale * (1 + o.grow), duration: life * 1000, ease: 'Quad.easeOut' });
    if (o.follow) this.followers.push({ obj: img, unit: o.follow, dy: y - o.follow.y });
    return img;
  }

  /** Play one of the looping auras under a unit for `seconds`. */
  private auraOnce(name: AuraName, unit: Unit, seconds: number): void {
    const spr = this.add.sprite(unit.x, unit.y + 1, AURA_ATLAS).setScale(FX_SCALE).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GROUND_FX + 3).setAlpha(0);
    spr.play(`aura_${name}`);
    this.tweens.add({ targets: spr, alpha: 1, duration: 150 });
    this.tweens.add({ targets: spr, alpha: 0, delay: seconds * 1000 - 300, duration: 300, onComplete: () => spr.destroy() });
    this.followers.push({ obj: spr, unit, dy: 1 });
  }

  private onLevelUp(): void {
    const h = this.hero;
    const talent = h.level % 2 === 0 ? ' and a talent point' : '';
    this.hud.toast(`Level ${h.level}! A skill point${talent}`, 'good');
    this.levelUpFx();
  }

  /** Coins for the hero, with a little gold number where they dropped. */
  giveGold(x: number, y: number, amount: number): void {
    if (this.hero.dead || amount <= 0) return;
    this.hero.gold += amount;
    this.floatText(x, y - 10, `+${amount}g`, '#ffd84a');
  }

  /** Level up: the gold column of light around the hero, with the precision aura at its feet. */
  private levelUpFx(): void {
    const h = this.hero;
    const col = this.fxOnce('levelup', h.x, h.y + 2, { life: 1.6, originY: 0.93, follow: h, depth: h.y + 1 });
    // The column stands around the hero: draw it just behind them so the light frames the sprite.
    col.setDepth(h.y - 1);
    this.auraOnce('precision', h, 1.6);
  }

  hitSpark(x: number, y: number): void {
    const s = this.add.sprite(x, y + 3, FX_ATLAS, 'ground_impact_0').setOrigin(0.5, 0.8).setScale(FX_SCALE * 0.45).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 6);
    s.play('fx_impact');
    this.tweens.add({ targets: s, alpha: 0, delay: 120, duration: 160, onComplete: () => s.destroy() });
  }

  dashTrail(fx: number, fy: number, tx: number, ty: number): void {
    const d = Math.hypot(tx - fx, ty - fy);
    if (d < 4) return;
    // The trail frames point right with the burst at their right end: put that end at the landing spot.
    const s = this.add.sprite(tx, ty - 6, FX_ATLAS, 'winddash_0').setOrigin(0.92, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_OVERLAY - 5);
    s.setRotation(Math.atan2(ty - fy, tx - fx));
    s.setScale(Math.min(FX_SCALE, (d + 12) / s.width), FX_SCALE * 0.8);
    s.play('fx_winddash');
    this.tweens.add({ targets: s, alpha: 0, delay: 200, duration: 250, onComplete: () => s.destroy() });
    this.auraOnce('wind', this.hero, 0.6);
  }

  // --- Main loop ----------------------------------------------------------------------------

  update(_time: number, deltaMs: number): void {
    if (!this.ready) return;
    const dt = Math.min(0.05, deltaMs / 1000);

    for (const u of this.units) u.update(dt);
    Unit.separate(this.units, this.map, dt);
    for (const a of this.arrows) a.update(dt);
    this.arrows = this.arrows.filter((a) => !a.done);

    this.updateRespawns(dt);
    this.updateMoonwell(dt);
    this.updateVillagers();
    this.updateTownsfolk(dt);
    this.updateHeroBuffs();
    this.checkPortals();
    this.updateCamera(dt);
    this.updateGround();
    this.cullProps();
    this.drawMarkers(dt);
    this.drawBars();
    this.drawAim();
    this.updateDarkness();

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
    this.wellAura.setPosition(h.x, h.y + 1);
    this.wellAura.setAlpha(this.wellAura.alpha + ((near ? 1 : 0) - this.wellAura.alpha) * Math.min(1, dt * 5));
    const target = near ? 0.45 : 0.2 + Math.sin(this.time.now / 600) * 0.06;
    this.wellGlow.setAlpha(this.wellGlow.alpha + (target - this.wellGlow.alpha) * Math.min(1, dt * 4));
  }

  private updateRespawns(dt: number): void {
    const h = this.hero;
    if (h.dead && h.respawnT <= 0) {
      // Come back at the sanctuary.
      h.revive(this.map.spawn.x * TILE, this.map.spawn.y * TILE);
      this.cameraLocked = true;
      this.burst(h.x, h.y - 8, 0x7dff6a, 14);
      this.hud.toast(`${this.hero.cls.hero} returns!`, 'good');
    }
    if (this.map.kind === 'dungeon') return;
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
    // Sprites are anchored at their feet and can be ~125px wide (the cathedral) and ~120px tall.
    const m = TILE * 5;
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
    for (const m of this.markers) {
      m.t += dt;
      const p = Math.min(1, m.t / MARKER_LIFE);
      m.img.setScale(m.scale * (1 - 0.45 * p)).setAlpha(1 - p * p);
      if (p >= 1) m.img.destroy();
    }
    this.markers = this.markers.filter((m) => m.t < MARKER_LIFE);
    // Effects that stay on a unit (heal, auras, level-up column).
    this.followers = this.followers.filter((f) => f.obj.active);
    for (const f of this.followers) f.obj.setPosition(f.unit.x, f.unit.y + f.dy);
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
    this.aimCone.setVisible(false);
    this.aimLine.setVisible(false);
    this.aimCircle.setVisible(false);
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
    // Out of range (and not clamped): the indicator dims until the aim comes back in.
    const alpha = out && !ab.clampToRange ? 0.35 : 0.8;
    const pv = ab.preview;
    if (pv?.shape === 'circle') {
      // The rune circle, sized so its rim is exactly the area of effect.
      const c = this.aimCircle;
      c.setPosition(ax, ay).setScale((pv.radius * 2) / (c.width * AOE_RIM)).setAlpha(alpha).setVisible(true);
    } else if (pv?.shape === 'cone') {
      // The cone from the hero, stretched to the ability's reach and spread.
      const c = this.aimCone;
      const sx = pv.length / c.width;
      const sy = sx * (Math.tan(pv.spread / 2) / Math.tan(CONE_HALF_SPREAD));
      c.setPosition(h.x, h.y).setRotation(Math.atan2(ay - h.y, ax - h.x)).setScale(sx, sy).setAlpha(alpha).setVisible(true);
    } else if (pv?.shape === 'line') {
      const c = this.aimLine;
      const d = Math.max(8, Math.hypot(ax - h.x, ay - h.y));
      c.setPosition(h.x, h.y).setRotation(Math.atan2(ay - h.y, ax - h.x)).setScale(d / c.width, (pv.width * 1.4) / c.height).setAlpha(alpha).setVisible(true);
    }
  }
}
