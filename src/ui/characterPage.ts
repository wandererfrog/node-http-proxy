import { Hero, MAX_LEVEL, xpForLevel } from '../entities/Hero';
import {
  EMPTY_STATS,
  Gear,
  GearSlot,
  GearStats,
  INVENTORY_SIZE,
  ITEMS,
  ItemId,
  SLOT_NAMES,
  TIERS,
  describeStats,
  gearIcon,
} from '../entities/items';
import { statIconUrl } from '../art/sprites';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface CharacterCallbacks {
  /** Drink a potion from the bag. */
  use(id: ItemId): void;
  /** Wear the gear in a bag slot (swapping with whatever is worn). */
  equip(bagIndex: number): void;
  /** Take worn gear off into the bag. */
  unequip(slot: GearSlot): void;
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

/** Stat icon data URLs, made once. */
const STAT_URLS: Record<string, string> = {};
const statIcon = (name: string) => (STAT_URLS[name] ??= statIconUrl(name));

/**
 * Hero sheet, styled after the HUD mockup: a header with the round portrait, the paper doll of worn
 * gear around the hero, the stat list with icons, the six WC3-style bag slots, and an item card.
 * Tapping a slot selects it and shows its card with the action (wear, take off, drink); with a mouse,
 * hovering previews the card. The game keeps running while it is open, like in Warcraft III.
 */
export class CharacterPage {
  readonly root: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly levelBadge: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly gearSlots = new Map<GearSlot, HTMLButtonElement>();
  private readonly bagSlots: HTMLButtonElement[] = [];
  private readonly card: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private selected: Selection | null = null;
  /** Hover preview (mouse); the selection wins when both exist. */
  private hovered: Selection | null = null;
  private cardKey = '';

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
    const figure = el('div', 'doll-figure', doll);
    const fig = el('img', '', figure);
    fig.src = dollUrl;
    fig.alt = '';
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
      this.wireSlot(b, { kind: 'worn', slot: d.slot });
      this.gearSlots.set(d.slot, b);
    }

    // --- Stats and bag.
    const side = el('div', 'char-side', content);
    this.stats = el('div', 'char-stats', side);
    el('div', 'char-label', side).textContent = 'Bag';
    const grid = el('div', 'inv-grid', side);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const b = el('button', 'inv-slot', grid);
      b.setAttribute('aria-label', `Bag slot ${i + 1}`);
      this.wireSlot(b, { kind: 'bag', index: i });
      this.bagSlots.push(b);
    }
    el('div', 'char-hint', side).textContent = 'Tap an item to see it.';

    // --- Item card: beside the panel when there is room, over the stats column otherwise.
    this.card = el('div', 'char-card off', wrap);
    this.card.setAttribute('aria-live', 'polite');
  }

  private wireSlot(b: HTMLButtonElement, sel: Selection): void {
    b.addEventListener('click', () => {
      const same = this.selected !== null && this.sameSel(this.selected, sel);
      this.selected = same ? null : sel;
      this.menu.classList.add('hidden');
      this.renderCard(true);
    });
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hovered = sel;
      this.renderCard(true);
    });
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hovered = null;
      this.renderCard(true);
    });
  }

  private sameSel(a: Selection, b: Selection): boolean {
    if (a.kind === 'worn' && b.kind === 'worn') return a.slot === b.slot;
    if (a.kind === 'bag' && b.kind === 'bag') return a.index === b.index;
    return false;
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('hidden', !open);
    this.selected = null;
    this.hovered = null;
    this.menu.classList.add('hidden');
    if (open) {
      this.cardKey = '-';
      this.refresh();
    }
  }

  /** The item a selection points at right now (it changes as gear moves). */
  private itemAt(sel: Selection): { gear?: Gear; stack?: { id: ItemId; count: number } } | null {
    if (sel.kind === 'worn') {
      const g = this.hero.equipment[sel.slot];
      return g ? { gear: g } : null;
    }
    const s = this.hero.inventory.slots[sel.index];
    if (!s) return null;
    return s.kind === 'gear' ? { gear: s.gear } : { stack: { id: s.id, count: s.count } };
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
    const s = this.selected;
    if (s) (s.kind === 'worn' ? this.gearSlots.get(s.slot) : this.bagSlots[s.index])?.classList.add('selected');
  }

  private renderCard(force = false): void {
    // A selection whose slot has emptied (drank the last potion, gear moved) is dropped.
    if (this.selected && !this.itemAt(this.selected)) this.selected = null;
    const sel = this.selected ?? this.hovered;
    const item = sel ? this.itemAt(sel) : null;
    this.markSelected();
    const wornInSlot = item?.gear ? this.hero.equipment[item.gear.slot] ?? null : null;
    const key = sel && item ? JSON.stringify([sel, item, !!this.selected, wornInSlot, this.hero.inventory.firstFree() < 0]) : '';
    if (!force && key === this.cardKey) return;
    this.cardKey = key;
    const c = this.card;
    c.innerHTML = '';
    if (!sel || !item) {
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

    if (item.gear) {
      const g = item.gear;
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
      if (this.selected) {
        const act = el('button', 'card-action', c);
        if (worn) {
          const full = this.hero.inventory.firstFree() < 0;
          act.textContent = full ? 'Bag full' : 'Take off';
          act.disabled = full;
          act.addEventListener('click', () => {
            this.cb.unequip(g.slot);
            const i = this.hero.inventory.slots.findIndex((s) => s?.kind === 'gear' && s.gear === g);
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
    } else if (item.stack) {
      const def = ITEMS[item.stack.id];
      const id = item.stack.id;
      ic.src = this.icon(def.icon);
      name.textContent = def.name;
      rarity.textContent = 'Consumable';
      rarity.style.color = '#b8b0a0';
      const row = el('div', 'card-row', c);
      el('span', '', row).textContent = def.description;
      el('span', 'muted', row).textContent = `×${item.stack.count}`;
      if (this.selected) {
        const act = el('button', 'card-action', c);
        act.textContent = 'Drink';
        act.addEventListener('click', () => {
          this.cb.use(id);
          this.renderCard(true);
        });
      }
    }
  }

  private renderSlot(b: HTMLButtonElement, entry: { icon: string; tier?: number; count?: number; name: string } | null): void {
    const key = entry ? `${entry.icon}:${entry.tier ?? ''}:${entry.count ?? ''}` : '';
    if (b.dataset.key === key) return;
    b.dataset.key = key;
    b.querySelector('.item')?.remove();
    b.querySelector('.count')?.remove();
    b.classList.toggle('filled', !!entry);
    const color = entry && entry.tier !== undefined ? TIERS[entry.tier].color : '';
    b.style.borderColor = color;
    b.style.setProperty('--glow', color || 'transparent');
    if (!entry) return;
    const img = el('img', 'item', b);
    img.src = this.icon(entry.icon);
    img.alt = entry.name;
    if (entry.count !== undefined) el('span', 'count', b).textContent = `${entry.count}`;
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

    for (const [slot, b] of this.gearSlots) {
      const g = h.equipment[slot];
      this.renderSlot(b, g ? { icon: g.icon, tier: g.tier, name: g.name } : null);
    }
    h.inventory.slots.forEach((s, i) => {
      const b = this.bagSlots[i];
      if (!s) this.renderSlot(b, null);
      else if (s.kind === 'stack') this.renderSlot(b, { icon: ITEMS[s.id].icon, count: s.count, name: ITEMS[s.id].name });
      else this.renderSlot(b, { icon: s.gear.icon, tier: s.gear.tier, name: s.gear.name });
    });
    this.renderCard();
  }
}
