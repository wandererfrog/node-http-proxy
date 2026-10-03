import { Hero, MAX_LEVEL, xpForLevel } from '../entities/Hero';
import { EMPTY_STATS, Gear, GearSlot, GearStats, INVENTORY_SIZE, SLOT_NAMES, TIERS, describeStats, gearIcon } from '../entities/items';
import { statIconUrl } from '../art/sprites';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface CharacterCallbacks {
  /** Wear the gear in a bag slot (whatever was worn goes into that bag slot). */
  equip(bagIndex: number): void;
  /** Take worn gear off into the bag: into `toIndex` when given and empty, else the first free slot. */
  unequip(slot: GearSlot, toIndex?: number): void;
  /** Rearrange the bag: swap two slots. */
  moveBag(from: number, to: number): void;
  close(): void;
  /** Start over in a new world (asks once). */
  newGame(): void;
}

/**
 * Paper doll: four slots down each side of the hero, and the bow (the main weapon) under them.
 * The game has nine gear slots, so the weapon gets the centre and the sides stay symmetric.
 */
const DOLL: Array<{ slot: GearSlot; col: number; row: number }> = [
  { slot: 'helmet', col: 1, row: 1 },
  { slot: 'chest', col: 1, row: 2 },
  { slot: 'gloves', col: 1, row: 3 },
  { slot: 'boots', col: 1, row: 4 },
  { slot: 'amulet', col: 3, row: 1 },
  { slot: 'cloak', col: 3, row: 2 },
  { slot: 'ring', col: 3, row: 3 },
  { slot: 'quiver', col: 3, row: 4 },
  { slot: 'bow', col: 2, row: 5 },
];

type Selection = { kind: 'worn'; slot: GearSlot } | { kind: 'bag'; index: number };

/** Pointer travel (px) before a press on an item becomes a drag. */
const DRAG_START = 6;

/** Stat icon data URLs, made once. */
const STAT_URLS: Record<string, string> = {};
const statIcon = (name: string) => (STAT_URLS[name] ??= statIconUrl(name));

interface Drag {
  from: Selection;
  gear: Gear;
  pointerId: number;
  startX: number;
  startY: number;
  ghost: HTMLImageElement | null;
  over: HTMLElement | null;
}

/**
 * Hero sheet, styled after the HUD mockup: a header with the round portrait, the paper doll of worn
 * gear around the hero, the stat list with icons, the six WC3-style bag slots (gear only; potions
 * live on the 1 / 2 belt), and an item card.
 *
 * Gear moves by drag and drop: drag from the bag onto its slot (or onto the hero) to wear it, from a
 * worn slot to the bag to take it off, and between bag slots to rearrange. A tap selects an item
 * and shows its card, with the same actions as buttons; a mouse hover previews the card. The game
 * keeps running while the page is open, like in Warcraft III.
 */
export class CharacterPage {
  readonly root: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly levelBadge: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly figure: HTMLDivElement;
  private readonly gearSlots = new Map<GearSlot, HTMLButtonElement>();
  private readonly bagSlots: HTMLButtonElement[] = [];
  private readonly card: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private selected: Selection | null = null;
  /** Hover preview (mouse); the selection wins when both exist. */
  private hovered: Selection | null = null;
  private cardKey = '';
  private drag: Drag | null = null;
  /** Set when a drag ends, so the click that follows the pointerup doesn't also toggle the selection. */
  private swallowClick = false;

  constructor(
    parent: HTMLElement,
    private readonly hero: Hero,
    portraitUrl: string,
    dollUrl: string,
    private readonly icon: (frame: string) => string,
    private readonly cb: CharacterCallbacks,
  ) {
    this.root = el('div', 'char-page hidden', parent);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.cb.close();
    });
    const wrap = el('div', 'char-wrap', this.root);
    const panel = el('div', 'char-panel', wrap);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Character');
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `corner ${c}`, panel);

    // --- Header: portrait ring with the level badge, name, class and level, XP; menu and close.
    const head = el('div', 'char-head', panel);
    const ring = el('div', 'char-ring', head);
    const img = el('img', '', ring);
    img.src = portraitUrl;
    img.alt = '';
    this.levelBadge = el('div', 'char-lvl', ring);
    const titles = el('div', 'char-titles', head);
    el('div', 'char-name', titles).textContent = 'Sylva';
    this.sub = el('div', 'char-sub', titles);
    const xp = el('div', 'char-xp', titles);
    this.xpFill = el('div', 'fill', xp);

    const more = el('button', 'char-more', head);
    more.textContent = '⋯';
    more.setAttribute('aria-label', 'More');
    this.menu = el('div', 'char-menu hidden', head);
    const reset = el('button', '', this.menu);
    reset.textContent = 'New game';
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Start over? Tap again';
        reset.classList.add('armed');
        setTimeout(() => {
          armed = false;
          reset.textContent = 'New game';
          reset.classList.remove('armed');
        }, 3000);
        return;
      }
      this.cb.newGame();
    });
    more.addEventListener('click', () => this.menu.classList.toggle('hidden'));
    const close = el('button', 'char-close', head);
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.cb.close());

    const content = el('div', 'char-content', panel);

    // --- Paper doll.
    const doll = el('div', 'char-doll', content);
    this.figure = el('div', 'doll-figure', doll);
    const fig = el('img', '', this.figure);
    fig.src = dollUrl;
    fig.alt = '';
    fig.draggable = false;
    for (const d of DOLL) {
      const b = el('button', 'inv-slot gear-slot', doll);
      b.style.gridColumn = `${d.col}`;
      b.style.gridRow = `${d.row}`;
      b.dataset.slot = d.slot;
      b.setAttribute('aria-label', SLOT_NAMES[d.slot]);
      b.title = SLOT_NAMES[d.slot];
      // Faint silhouette of what goes here, shown while the slot is empty.
      const ghost = el('img', 'ghost', b);
      ghost.src = this.icon(gearIcon(d.slot, 0));
      ghost.alt = '';
      ghost.draggable = false;
      this.wireSlot(b, { kind: 'worn', slot: d.slot });
      this.gearSlots.set(d.slot, b);
    }

    // --- Stats and bag.
    const side = el('div', 'char-side', content);
    this.stats = el('div', 'char-stats', side);
    el('div', 'char-label', side).textContent = 'Bag';
    const grid = el('div', 'inv-grid', side);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const b = el('button', 'inv-slot bag-slot', grid);
      b.dataset.bag = `${i}`;
      b.setAttribute('aria-label', `Bag slot ${i + 1}`);
      this.wireSlot(b, { kind: 'bag', index: i });
      this.bagSlots.push(b);
    }
    el('div', 'char-hint', side).textContent = 'Drag gear onto the hero to wear it. Tap for details.';

    // --- Item card: beside the panel when there is room, over the stats column otherwise.
    this.card = el('div', 'char-card off', wrap);
    this.card.setAttribute('aria-live', 'polite');
  }

  // --- Input ----------------------------------------------------------------------------------

  private wireSlot(b: HTMLButtonElement, sel: Selection): void {
    b.addEventListener('click', () => {
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      const same = this.selected !== null && this.sameSel(this.selected, sel);
      this.selected = same ? null : sel;
      this.menu.classList.add('hidden');
      this.renderCard(true);
    });
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || this.drag) return;
      this.hovered = sel;
      this.renderCard(true);
    });
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || this.drag) return;
      this.hovered = null;
      this.renderCard(true);
    });
    b.addEventListener('pointerdown', (e) => {
      if (this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const gear = this.gearAt(sel);
      if (!gear) return;
      this.drag = { from: sel, gear, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ghost: null, over: null };
      window.addEventListener('pointermove', this.onDragMove);
      window.addEventListener('pointerup', this.onDragEnd);
      window.addEventListener('pointercancel', this.onDragCancel);
    });
  }

  private readonly onDragMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START) return;
      this.beginDrag(d);
    }
    e.preventDefault();
    d.ghost!.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
    const over = this.dropTargetAt(e.clientX, e.clientY);
    if (over !== d.over) {
      d.over?.classList.remove('drop-over');
      over?.classList.add('drop-over');
      d.over = over;
    }
  };

  private readonly onDragEnd = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.ghost) {
      this.swallowClick = true;
      setTimeout(() => (this.swallowClick = false), 0);
      this.drop(d, this.dropTargetAt(e.clientX, e.clientY));
    }
    this.endDrag();
  };

  private readonly onDragCancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag();
  };

  private beginDrag(d: Drag): void {
    const g = el('img', 'drag-ghost', document.body);
    g.src = this.icon(d.gear.icon);
    g.alt = '';
    g.style.borderColor = TIERS[d.gear.tier].color;
    d.ghost = g;
    this.root.classList.add('dragging');
    this.slotEl(d.from)?.classList.add('drag-source');
    for (const t of this.validTargets(d)) t.classList.add('drop-ok');
    this.hovered = null;
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    d.ghost?.remove();
    this.root.classList.remove('dragging');
    for (const e of this.root.querySelectorAll('.drop-ok, .drop-over, .drag-source')) e.classList.remove('drop-ok', 'drop-over', 'drag-source');
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragCancel);
    this.drag = null;
  }

  /** The slot (or the hero figure) under a screen point, if it's a place this drag can drop on. */
  private dropTargetAt(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.inv-slot, .doll-figure') ?? null;
    return hit && this.drag && this.validTargets(this.drag).includes(hit) ? hit : null;
  }

  /**
   * Where a dragged piece can go. From the bag: its own gear slot, the hero figure (same thing), or
   * any other bag slot (to rearrange). From a worn slot: an empty bag slot, or one holding gear for
   * the same slot (a swap).
   */
  private validTargets(d: Drag): HTMLElement[] {
    if (d.from.kind === 'bag') {
      const from = d.from.index;
      return [this.gearSlots.get(d.gear.slot)!, this.figure, ...this.bagSlots.filter((_, i) => i !== from)];
    }
    return this.bagSlots.filter((_, i) => {
      const s = this.hero.inventory.slots[i];
      return !s || s.gear.slot === d.gear.slot;
    });
  }

  private drop(d: Drag, target: HTMLElement | null): void {
    if (!target) return;
    if (d.from.kind === 'bag') {
      const from = d.from.index;
      if (target === this.figure || target.dataset.slot === d.gear.slot) {
        this.cb.equip(from);
        this.selected = { kind: 'worn', slot: d.gear.slot };
      } else if (target.dataset.bag !== undefined) {
        const to = Number(target.dataset.bag);
        this.cb.moveBag(from, to);
        this.selected = { kind: 'bag', index: to };
      }
    } else if (target.dataset.bag !== undefined) {
      const to = Number(target.dataset.bag);
      const there = this.hero.inventory.slots[to];
      if (there) this.cb.equip(to); // same slot type: swap them
      else this.cb.unequip(d.gear.slot, to);
      this.selected = { kind: 'bag', index: to };
    }
    this.renderCard(true);
  }

  // --- State ----------------------------------------------------------------------------------

  private sameSel(a: Selection, b: Selection): boolean {
    if (a.kind === 'worn' && b.kind === 'worn') return a.slot === b.slot;
    if (a.kind === 'bag' && b.kind === 'bag') return a.index === b.index;
    return false;
  }

  private slotEl(sel: Selection): HTMLButtonElement | undefined {
    return sel.kind === 'worn' ? this.gearSlots.get(sel.slot) : this.bagSlots[sel.index];
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    this.endDrag();
    this.root.classList.toggle('hidden', !open);
    this.selected = null;
    this.hovered = null;
    this.menu.classList.add('hidden');
    if (open) {
      this.cardKey = '-';
      this.refresh();
    }
  }

  /** The gear a selection points at right now (it changes as gear moves). */
  private gearAt(sel: Selection): Gear | null {
    if (sel.kind === 'worn') return this.hero.equipment[sel.slot] ?? null;
    return this.hero.inventory.slots[sel.index]?.gear ?? null;
  }

  /** Stat differences of `g` against what is worn in its slot, as signed lines. */
  private compareLines(g: Gear): Array<{ text: string; good: boolean }> {
    const worn = this.hero.equipment[g.slot];
    const base: GearStats = worn ? worn.stats : EMPTY_STATS;
    const label: Record<keyof GearStats, string> = {
      damage: ' damage',
      hp: ' health',
      mana: ' mana',
      armor: ' armour',
      speed: ' move speed',
      attackSpeed: '% attack speed',
      hpRegen: ' health/s',
      manaRegen: ' mana/s',
    };
    const lines: Array<{ text: string; good: boolean }> = [];
    for (const k of Object.keys(label) as Array<keyof GearStats>) {
      const d = Math.round((g.stats[k] - base[k]) * 10) / 10;
      if (d) lines.push({ text: `${d > 0 ? '+' : '−'}${Math.abs(d)}${label[k]}`, good: d > 0 });
    }
    return lines;
  }

  private markSelected(): void {
    for (const b of [...this.gearSlots.values(), ...this.bagSlots]) b.classList.remove('selected');
    if (this.selected) this.slotEl(this.selected)?.classList.add('selected');
  }

  // --- Rendering ------------------------------------------------------------------------------

  private renderCard(force = false): void {
    // A selection whose slot has emptied (gear moved away) is dropped.
    if (this.selected && !this.gearAt(this.selected)) this.selected = null;
    const sel = this.selected ?? this.hovered;
    const g = sel ? this.gearAt(sel) : null;
    this.markSelected();
    const wornInSlot = g ? this.hero.equipment[g.slot] ?? null : null;
    const key = sel && g ? JSON.stringify([sel, g, !!this.selected, wornInSlot, this.hero.inventory.firstFree() < 0]) : '';
    if (!force && key === this.cardKey) return;
    this.cardKey = key;
    const c = this.card;
    c.innerHTML = '';
    if (!sel || !g) {
      c.classList.add('off');
      return;
    }
    c.classList.remove('off');
    for (const k of ['tl', 'tr', 'bl', 'br']) el('i', `corner ${k}`, c);
    const head = el('div', 'card-head', c);
    const box = el('div', 'card-icon', head);
    const ic = el('img', '', box);
    const titles = el('div', 'card-titles', head);
    const name = el('div', 'card-name', titles);
    const rarity = el('div', 'card-rarity', titles);
    const x = el('button', 'card-x', head);
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Close item');
    x.addEventListener('click', () => {
      this.selected = null;
      this.hovered = null;
      this.renderCard(true);
    });

    const tier = TIERS[g.tier];
    ic.src = this.icon(g.icon);
    box.style.borderColor = tier.color;
    name.textContent = g.name;
    name.style.color = tier.color;
    rarity.textContent = tier.rarity;
    rarity.style.color = tier.color;
    const type = el('div', 'card-row', c);
    el('span', '', type).textContent = SLOT_NAMES[g.slot];
    el('span', 'muted', type).textContent = `Item level ${g.level}`;
    el('hr', '', c);
    const statsBox = el('div', 'card-stats', c);
    for (const line of describeStats(g.stats)) el('div', '', statsBox).textContent = line;
    const worn = sel.kind === 'worn';
    if (worn) {
      el('div', 'card-note', c).textContent = 'Equipped';
    } else {
      el('hr', '', c);
      const cmpBox = el('div', 'card-compare', c);
      el('div', 'muted', cmpBox).textContent = wornInSlot ? `Compared with ${wornInSlot.name}:` : 'Nothing worn in this slot.';
      const cmp = this.compareLines(g);
      if (wornInSlot && cmp.length === 0) el('div', 'muted', cmpBox).textContent = 'No change.';
      for (const l of cmp) el('div', l.good ? 'up' : 'down', cmpBox).textContent = l.text;
    }
    if (!this.selected) return;
    const act = el('button', 'card-action', c);
    if (worn) {
      const full = this.hero.inventory.firstFree() < 0;
      act.textContent = full ? 'Bag full' : 'Take off';
      act.disabled = full;
      act.addEventListener('click', () => {
        this.cb.unequip(g.slot);
        const i = this.hero.inventory.slots.findIndex((s) => s?.gear === g);
        this.selected = i >= 0 ? { kind: 'bag', index: i } : null;
        this.renderCard(true);
      });
    } else {
      const index = (sel as { index: number }).index;
      act.textContent = 'Wear';
      act.addEventListener('click', () => {
        this.cb.equip(index);
        if (this.hero.equipment[g.slot] === g) this.selected = { kind: 'worn', slot: g.slot };
        this.renderCard(true);
      });
    }
  }

  private renderSlot(b: HTMLButtonElement, g: Gear | null): void {
    const key = g ? `${g.icon}:${g.tier}` : '';
    if (b.dataset.key === key) return;
    b.dataset.key = key;
    b.querySelector('.item')?.remove();
    b.classList.toggle('filled', !!g);
    const color = g ? TIERS[g.tier].color : '';
    b.style.borderColor = color;
    b.style.setProperty('--glow', color || 'transparent');
    if (!g) return;
    const img = el('img', 'item', b);
    img.src = this.icon(g.icon);
    img.alt = g.name;
    img.draggable = false;
  }

  /** Re-render live values. Cheap enough to call every frame while open. */
  refresh(): void {
    if (!this.open) return;
    const h = this.hero;
    const lo = xpForLevel(h.level);
    const hi = xpForLevel(h.level + 1);
    const maxed = h.level >= MAX_LEVEL;
    const sub = `Ranger • Level ${h.level}${maxed ? '' : ` · ${h.xp - lo} / ${hi - lo} XP`}`;
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
    if (this.levelBadge.textContent !== `${h.level}`) this.levelBadge.textContent = `${h.level}`;
    this.xpFill.style.width = `${maxed ? 100 : Math.min(100, ((h.xp - lo) / (hi - lo)) * 100)}%`;

    const [dmin, dmax] = h.damageRange;
    const rows: Array<[string, string, string] | null> = [
      ['health', 'Health', `${Math.ceil(h.hp)} / ${h.maxHp}`],
      ['mana', 'Mana', `${Math.floor(h.mana)} / ${h.maxMana}`],
      null,
      ['damage', 'Damage', `${dmin} – ${dmax}`],
      ['armor', 'Armour', `${h.armor}`],
      ['speed', 'Move Speed', `${h.speed}`],
      ['attackSpeed', 'Attack Speed', `${(1 / h.attackCooldown).toFixed(2)}`],
      ['range', 'Range', `${Math.round(h.attackRange / 16)}`],
    ];
    const html = rows
      .map((r) => (r ? `<div class="stat"><img src="${statIcon(r[0])}" alt=""><span>${r[1]}</span><b>${r[2]}</b></div>` : '<hr>'))
      .join('');
    if (this.stats.innerHTML !== html) this.stats.innerHTML = html;

    for (const [slot, b] of this.gearSlots) this.renderSlot(b, h.equipment[slot] ?? null);
    h.inventory.slots.forEach((s, i) => this.renderSlot(this.bagSlots[i], s?.gear ?? null));
    this.renderCard();
  }
}
