import { iconDataUrl } from '../art/sprites';
import { Hero, MAX_LEVEL, xpForLevel } from '../entities/Hero';
import type { Unit } from '../entities/Unit';
import { SearingArrows } from '../abilities/rangerAbilities';
import { Tile, WorldMap } from '../world/map';
import { GearSlot, ITEMS, ItemId } from '../entities/items';
import { CharacterPage } from './characterPage';

export type Command = 'attack' | 'stop' | 'hold';

export interface HudCallbacks {
  /** Plain tap/click on an ability button: toggles, or enters "pick a target" mode. */
  abilityTap(i: number): void;
  /** Drag out of an ability button to aim it (mobile). dx/dy are 0..1 of the aim pad radius. */
  abilityAim(i: number, dx: number, dy: number): void;
  abilityAimEnd(i: number, cast: boolean): void;
  learn(i: number): void;
  command(c: Command): void;
  lockCamera(): void;
  minimapTap(fx: number, fy: number): void;
  cancelTargeting(): void;
  usePotion(id: ItemId): void;
  equip(bagIndex: number): void;
  unequip(slot: GearSlot): void;
  newGame(): void;
}

export interface CameraRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const AIM_PAD = 90; // css px of drag for a full-range aim

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

interface AbilityButton {
  root: HTMLDivElement;
  cd: HTMLDivElement;
  cdText: HTMLSpanElement;
  mana: HTMLSpanElement;
  pips: HTMLDivElement;
  learn: HTMLButtonElement;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLSpanElement;
  private readonly mpFill: HTMLDivElement;
  private readonly mpText: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly levelBadge: HTMLDivElement;
  private readonly buttons: AbilityButton[] = [];
  private readonly toastBox: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerText: HTMLSpanElement;
  private readonly tooltip: HTMLDivElement;
  private readonly respawn: HTMLDivElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapBase: HTMLCanvasElement;
  private readonly cmdButtons: Partial<Record<Command, HTMLButtonElement>>;
  private readonly potionSlots: Array<{ id: ItemId; root: HTMLButtonElement; count: HTMLSpanElement }> = [];
  private readonly charPage: CharacterPage;

  constructor(
    parent: HTMLElement,
    private readonly hero: Hero,
    private readonly map: WorldMap,
    portraitUrl: string,
    dollUrl: string,
    private readonly icons: (frame: string) => string,
    private readonly cb: HudCallbacks,
  ) {
    this.root = el('div', 'hud', parent);

    // Hero frame (top-left)
    const frame = el('div', 'hero-frame', this.root);
    // Tapping the portrait (or the bag) opens the character page.
    const portrait = el('button', 'portrait', frame);
    portrait.title = 'Character & inventory (C)';
    portrait.addEventListener('click', () => this.toggleCharacter());
    const img = el('img', '', portrait);
    img.src = portraitUrl;
    img.alt = 'Ranger';
    this.levelBadge = el('div', 'level', portrait);
    const bars = el('div', 'bars', frame);
    const name = el('div', 'hero-name', bars);
    name.textContent = 'Sylva, Ranger';
    const hp = el('div', 'bar hp', bars);
    this.hpFill = el('div', 'fill', hp);
    this.hpText = el('span', 'txt', hp);
    const mp = el('div', 'bar mp', bars);
    this.mpFill = el('div', 'fill', mp);
    this.mpText = el('span', 'txt', mp);
    const xp = el('div', 'bar xp', bars);
    this.xpFill = el('div', 'fill', xp);
    const bag = el('button', 'bag-btn', frame);
    bag.innerHTML = `<img src="${this.icons('misc_7')}" alt="">`;
    bag.title = 'Character & inventory (C)';
    bag.setAttribute('aria-label', 'Character and inventory');
    bag.addEventListener('click', () => this.toggleCharacter());

    // Minimap (top-right)
    const mmWrap = el('div', 'minimap-wrap', this.root);
    this.minimap = el('canvas', 'minimap', mmWrap);
    this.minimap.width = map.width * 2;
    this.minimap.height = map.height * 2;
    this.minimapBase = this.renderMinimapBase();
    this.minimap.addEventListener('pointerdown', (e) => {
      const r = this.minimap.getBoundingClientRect();
      this.cb.minimapTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      e.stopPropagation();
    });
    this.lockBtn = el('button', 'lock-btn', mmWrap);
    this.lockBtn.textContent = '◎ Follow';
    this.lockBtn.addEventListener('click', () => this.cb.lockCamera());

    // Command card (bottom-right)
    // Unit commands sit bottom-left under the left thumb; abilities sit bottom-right.
    const cmds = el('div', 'command-left', this.root);
    const mkCmd = (c: Command, icon: string, key: string, title: string) => {
      const b = el('button', 'cmd', cmds);
      b.innerHTML = `<img src="${iconDataUrl(icon, 3)}" alt=""><span class="hk">${key}</span>`;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.command(c);
      });
      return b;
    };
    this.cmdButtons = {
      attack: mkCmd('attack', 'attack', 'A', 'Attack-move (A): walk to a spot, fighting anything on the way'),
    };
    this.cmdButtons.attack!.classList.add('big');
    // Potion quick slots beside the attack button (keys 1 and 2).
    (['hp_potion', 'mp_potion'] as ItemId[]).forEach((id, i) => {
      const b = el('button', 'cmd potion', cmds);
      b.innerHTML = `<img src="${this.icons(ITEMS[id].icon)}" alt=""><span class="hk">${i + 1}</span>`;
      b.title = `${ITEMS[id].name} (${i + 1}): ${ITEMS[id].description}`;
      const count = el('span', 'count', b);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.usePotion(id);
      });
      this.potionSlots.push({ id, root: b, count });
    });
    const card = el('div', 'command-card', this.root);
    const abil = el('div', 'abilities', card);
    hero.abilities.forEach((ab, i) => this.buttons.push(this.makeAbilityButton(abil, i, ab.icon, ab.hotkey)));

    this.toastBox = el('div', 'toasts', this.root);
    this.banner = el('div', 'banner hidden', this.root);
    this.bannerText = el('span', '', this.banner);
    const cancel = el('button', 'cancel', this.banner);
    cancel.textContent = '✕ Cancel';
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.cancelTargeting();
    });
    this.tooltip = el('div', 'tooltip hidden', this.root);
    this.respawn = el('div', 'respawn hidden', this.root);
    this.charPage = new CharacterPage(this.root, hero, portraitUrl, dollUrl, this.icons, {
      use: (id) => this.cb.usePotion(id),
      equip: (i) => this.cb.equip(i),
      unequip: (slot) => this.cb.unequip(slot),
      close: () => this.toggleCharacter(false),
      newGame: () => this.cb.newGame(),
    });
  }

  private makeAbilityButton(parent: HTMLElement, i: number, icon: string, hotkey: string): AbilityButton {
    const root = el('div', 'ability', parent);
    const img = el('img', '', root);
    img.src = iconDataUrl(icon, 4);
    img.alt = '';
    img.draggable = false;
    const cd = el('div', 'cd', root);
    const cdText = el('span', 'cd-text', root);
    const hk = el('span', 'hk', root);
    hk.textContent = hotkey;
    const mana = el('span', 'mana', root);
    const pips = el('div', 'pips', root);
    const learn = el('button', 'learn hidden', root);
    learn.textContent = '+';
    learn.title = 'Learn';
    learn.addEventListener('pointerdown', (e) => e.stopPropagation());
    learn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.learn(i);
    });

    // Tap = activate, drag = aim (release outside the button to cast, back inside to cancel),
    // long-press = show tooltip.
    let start: { x: number; y: number; id: number } | null = null;
    let aiming = false;
    let tipShown = false;
    let pressTimer = 0;
    const inside = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      root.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      aiming = false;
      tipShown = false;
      root.classList.add('pressed');
      clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        if (!aiming && start) {
          tipShown = true;
          this.showTooltip(i, root);
        }
      }, 450);
    });
    root.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const canAim = this.hero.abilities[i].targeting === 'point' && this.hero.abilities[i].level > 0;
      if (!aiming && canAim && Math.hypot(dx, dy) > 16) {
        aiming = true;
        clearTimeout(pressTimer);
        this.hideTooltip();
      }
      if (aiming) {
        root.classList.toggle('cancel-zone', inside(e));
        this.cb.abilityAim(i, dx / AIM_PAD, dy / AIM_PAD);
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!start || e.pointerId !== start.id) return;
      clearTimeout(pressTimer);
      root.classList.remove('pressed', 'cancel-zone');
      if (aiming) this.cb.abilityAimEnd(i, !cancelled && !inside(e));
      else if (!tipShown && !cancelled) this.cb.abilityTap(i);
      if (tipShown) this.hideTooltip();
      start = null;
      aiming = false;
    };
    root.addEventListener('pointerup', (e) => end(e, false));
    root.addEventListener('pointercancel', (e) => end(e, true));
    root.addEventListener('mouseenter', () => this.showTooltip(i, root));
    root.addEventListener('mouseleave', () => this.hideTooltip());
    return { root, cd, cdText, mana, pips, learn };
  }

  private showTooltip(i: number, anchor: HTMLElement): void {
    const ab = this.hero.abilities[i];
    const lvl = ab.level;
    const next = lvl < ab.maxLevel ? `<div class="next">Next level: ${ab.describe(lvl + 1)} <em>(hero level ${ab.requiredHeroLevel(lvl + 1)})</em></div>` : '';
    const cost = ab.targeting === 'toggle' ? '' : ` · ${ab.manaCost()} mana · ${ab.cooldown()}s cooldown`;
    this.tooltip.innerHTML =
      `<div class="t-title">${ab.name} <span class="t-key">[${ab.hotkey}]</span></div>` +
      `<div class="t-sub">Level ${lvl}/${ab.maxLevel}${lvl ? cost : ''}</div>` +
      `<div>${ab.describe(lvl)}</div>${next}` +
      (ab.targeting === 'point' ? '<div class="hint">Tap, then tap the map — or drag from the button to aim.</div>' : '<div class="hint">Tap to toggle autocast.</div>');
    this.tooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
    this.tooltip.style.top = `${Math.max(8, r.top - this.tooltip.offsetHeight - 10)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.add('hidden');
  }

  toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const t = el('div', `toast ${kind}`, this.toastBox);
    t.textContent = msg;
    while (this.toastBox.children.length > 3) this.toastBox.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 1600);
    setTimeout(() => t.remove(), 2100);
  }

  setTargeting(label: string | null): void {
    this.banner.classList.toggle('hidden', !label);
    if (label) this.bannerText.textContent = label;
  }

  setActiveCommand(c: Command | null): void {
    for (const [k, b] of Object.entries(this.cmdButtons)) b.classList.toggle('active', k === c);
  }

  private renderMinimapBase(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.map.width * 2;
    c.height = this.map.height * 2;
    const ctx = c.getContext('2d')!;
    const colors: Record<number, string> = {
      [Tile.Grass]: '#4f9442',
      [Tile.Dirt]: '#b48a5a',
      [Tile.Water]: '#3a74c4',
      [Tile.Tree]: '#1f4a24',
      [Tile.Rock]: '#7a808c',
      [Tile.Chest]: '#ffd84a',
      [Tile.Block]: '#5a5e68',
      [Tile.Paved]: '#a8a4b8',
    };
    for (let y = 0; y < this.map.height; y++)
      for (let x = 0; x < this.map.width; x++) {
        ctx.fillStyle = colors[this.map.get(x, y)];
        ctx.fillRect(x * 2, y * 2, 2, 2);
      }
    return c;
  }

  get characterOpen(): boolean {
    return this.charPage.open;
  }

  toggleCharacter(open = !this.charPage.open): void {
    this.charPage.setOpen(open);
  }

  /** A rock was broken: paint its minimap pixel as grass. */
  clearMinimapTile(tx: number, ty: number): void {
    const ctx = this.minimapBase.getContext('2d')!;
    ctx.fillStyle = '#4f9442';
    ctx.fillRect(tx * 2, ty * 2, 2, 2);
  }

  update(units: readonly Unit[], cam: CameraRect, locked: boolean): void {
    const h = this.hero;
    for (const p of this.potionSlots) {
      const n = h.inventory.count(p.id);
      p.count.textContent = `${n}`;
      p.root.classList.toggle('empty', n === 0);
    }
    this.charPage.refresh();
    const hpP = Math.max(0, h.hp / h.maxHp);
    this.hpFill.style.width = `${hpP * 100}%`;
    this.hpFill.style.background = hpP > 0.5 ? '#3fbf4a' : hpP > 0.25 ? '#e0c030' : '#d0301a';
    this.hpText.textContent = `${Math.ceil(Math.max(0, h.hp))} / ${h.maxHp}`;
    this.mpFill.style.width = `${(h.mana / h.maxMana) * 100}%`;
    this.mpText.textContent = `${Math.floor(h.mana)} / ${h.maxMana}`;
    const lo = xpForLevel(h.level);
    const hi = xpForLevel(h.level + 1);
    this.xpFill.style.width = h.level >= MAX_LEVEL ? '100%' : `${((h.xp - lo) / (hi - lo)) * 100}%`;
    this.levelBadge.textContent = `${h.level}`;
    this.levelBadge.classList.toggle('points', h.skillPoints > 0);

    h.abilities.forEach((ab, i) => {
      const b = this.buttons[i];
      const learned = ab.level > 0;
      b.root.classList.toggle('unlearned', !learned);
      b.root.classList.toggle('nomana', learned && ab.targeting !== 'toggle' && h.mana < ab.manaCost());
      b.root.classList.toggle('autocast', ab instanceof SearingArrows && ab.autocast && learned);
      const cdTotal = ab.cooldown();
      const p = ab.cd > 0 && cdTotal > 0 ? ab.cd / cdTotal : 0;
      b.cd.style.setProperty('--p', `${p * 360}deg`);
      b.cd.style.display = p > 0 ? 'block' : 'none';
      b.cdText.textContent = ab.cd > 0 ? (ab.cd >= 1 ? `${Math.ceil(ab.cd)}` : ab.cd.toFixed(1)) : '';
      b.mana.textContent = learned ? `${ab.manaCost()}` : '';
      if (b.pips.childElementCount !== ab.maxLevel) {
        b.pips.innerHTML = '<i></i>'.repeat(ab.maxLevel);
      }
      Array.from(b.pips.children).forEach((pip, k) => pip.classList.toggle('on', k < ab.level));
      b.learn.classList.toggle('hidden', !ab.canLearn(h));
    });

    this.respawn.classList.toggle('hidden', !h.dead);
    if (h.dead) this.respawn.textContent = `Sylva has fallen — back in ${Math.max(0, Math.ceil(h.respawnT))}s`;
    this.lockBtn.classList.toggle('on', locked);

    // Minimap
    const ctx = this.minimap.getContext('2d')!;
    ctx.drawImage(this.minimapBase, 0, 0);
    const s = 2 / 16;
    for (const u of units) {
      if (u.dead) continue;
      ctx.fillStyle = u === h ? '#7dff6a' : '#ff4a3a';
      const r = u === h ? 3 : 2;
      ctx.fillRect(Math.round(u.x * s - r / 2), Math.round(u.y * s - r / 2), r, r);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(cam.x * s) + 0.5, Math.round(cam.y * s) + 0.5, Math.round(cam.w * s), Math.round(cam.h * s));
  }
}
