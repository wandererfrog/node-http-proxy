import { Hero, MAX_LEVEL, xpForLevel } from '../entities/Hero';
import { GEAR_SLOTS, Gear, GearSlot, INVENTORY_SIZE, ITEMS, ItemId, SLOT_NAMES, TIERS, describeStats } from '../entities/items';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface CharacterCallbacks {
  /** Tap a potion stack in the bag. */
  use(id: ItemId): void;
  /** Tap gear in the bag: equip it (swapping with whatever is worn). */
  equip(bagIndex: number): void;
  /** Tap worn gear: take it off into the bag. */
  unequip(slot: GearSlot): void;
  close(): void;
}

/**
 * Hero sheet: worn equipment, stats, and the six WC3-style bag slots.
 * The game keeps running while it is open, like in Warcraft III.
 */
export class CharacterPage {
  readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly stats: HTMLDListElement;
  private readonly gearSlots = new Map<GearSlot, HTMLButtonElement>();
  private readonly bagSlots: HTMLButtonElement[] = [];
  private readonly info: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly hero: Hero,
    portraitUrl: string,
    private readonly icon: (frame: string) => string,
    private readonly cb: CharacterCallbacks,
  ) {
    this.root = el('div', 'char-page hidden', parent);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.cb.close();
    });
    const panel = el('div', 'char-panel', this.root);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Character');

    const head = el('div', 'char-head', panel);
    const img = el('img', 'char-portrait', head);
    img.src = portraitUrl;
    img.alt = '';
    this.title = el('div', 'char-title', head);
    const close = el('button', 'char-close', head);
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.cb.close());

    const body = el('div', 'char-body', panel);

    const gearSec = el('section', 'char-gear', body);
    el('h3', '', gearSec).textContent = 'Equipment';
    const gearGrid = el('div', 'gear-grid', gearSec);
    for (const slot of GEAR_SLOTS) {
      const b = el('button', 'inv-slot gear-slot', gearGrid);
      b.dataset.slot = slot;
      el('span', 'slot-name', b).textContent = SLOT_NAMES[slot];
      b.addEventListener('click', () => {
        const g = this.hero.equipment[slot];
        if (g) {
          this.showGear(g, 'Worn. Tap to take off.');
          this.cb.unequip(slot);
        } else this.info.textContent = `${SLOT_NAMES[slot]}: nothing worn. Gear drops from creeps and chests.`;
      });
      b.addEventListener('pointerenter', () => {
        const g = this.hero.equipment[slot];
        if (g) this.showGear(g, 'Worn.');
      });
      this.gearSlots.set(slot, b);
    }

    const statSec = el('section', 'char-stats', body);
    el('h3', '', statSec).textContent = 'Stats';
    this.stats = el('dl', '', statSec);

    const bagSec = el('section', 'char-inv', body);
    el('h3', '', bagSec).textContent = 'Bag';
    const grid = el('div', 'inv-grid', bagSec);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const b = el('button', 'inv-slot', grid);
      b.addEventListener('click', () => {
        const s = this.hero.inventory.slots[i];
        if (!s) return;
        if (s.kind === 'stack') this.cb.use(s.id);
        else {
          this.showGear(s.gear, 'Equipping…');
          this.cb.equip(i);
        }
      });
      b.addEventListener('pointerenter', () => this.describeBag(i));
      b.addEventListener('focus', () => this.describeBag(i));
      this.bagSlots.push(b);
    }
    this.info = el('div', 'inv-info', bagSec);
    this.info.textContent = 'Tap a potion to drink it, tap gear to wear it. Search rocks for potions; creeps and chests drop gear.';
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('hidden', !open);
    if (open) {
      this.refresh();
      (this.root.firstElementChild as HTMLElement).scrollTop = 0;
    }
  }

  private describeBag(i: number): void {
    const s = this.hero.inventory.slots[i];
    if (!s) this.info.textContent = 'Empty slot';
    else if (s.kind === 'stack') this.info.textContent = `${ITEMS[s.id].name} (${s.count}): ${ITEMS[s.id].description}`;
    else this.showGear(s.gear, this.compare(s.gear));
  }

  /** How a bag item compares with what is worn in its slot. */
  private compare(g: Gear): string {
    const worn = this.hero.equipment[g.slot];
    if (!worn) return 'Nothing worn in that slot.';
    const a = describeStats(worn.stats).join(', ');
    return `Worn: ${worn.name} (${a}).`;
  }

  private showGear(g: Gear, note: string): void {
    const tier = TIERS[g.tier];
    this.info.innerHTML =
      `<b style="color:${tier.color}">${g.name}</b> <span class="muted">· level ${g.level}</span><br>` +
      `${describeStats(g.stats).join(' · ')}<br><span class="muted">${note}</span>`;
  }

  private renderSlot(b: HTMLButtonElement, entry: { icon: string; tier?: number; count?: number; name: string } | null): void {
    const key = entry ? `${entry.icon}:${entry.tier ?? ''}:${entry.count ?? ''}` : '';
    if (b.dataset.key === key) return;
    b.dataset.key = key;
    const label = b.querySelector('.slot-name');
    b.innerHTML = '';
    if (label) b.appendChild(label);
    if (!entry) {
      b.style.borderColor = '';
      b.title = label ? `${label.textContent}: empty` : 'Empty';
      return;
    }
    const img = el('img', '', b);
    img.src = this.icon(entry.icon);
    img.alt = entry.name;
    if (entry.count !== undefined) el('span', 'count', b).textContent = `${entry.count}`;
    b.style.borderColor = entry.tier !== undefined ? TIERS[entry.tier].color : '';
    b.title = entry.name;
  }

  /** Re-render live values. Cheap enough to call every frame while open. */
  refresh(): void {
    if (!this.open) return;
    const h = this.hero;
    this.title.innerHTML = `<b>Sylva</b><span>Ranger · Level ${h.level}</span>`;
    const lo = xpForLevel(h.level);
    const hi = xpForLevel(h.level + 1);
    const [dmin, dmax] = h.damageRange;
    const rows: Array<[string, string]> = [
      ['Experience', h.level >= MAX_LEVEL ? 'max level' : `${h.xp - lo} / ${hi - lo}`],
      ['Health', `${Math.ceil(h.hp)} / ${h.maxHp}  (+${h.hpRegen.toFixed(1)}/s)`],
      ['Mana', `${Math.floor(h.mana)} / ${h.maxMana}  (+${h.manaRegen.toFixed(1)}/s)`],
      ['Damage', `${dmin}–${dmax}`],
      ['Armour', `${h.armor}`],
      ['Attack speed', `${(1 / h.attackCooldown).toFixed(2)} / s`],
      ['Range', `${Math.round(h.attackRange / 16)} tiles`],
      ['Move speed', `${h.speed}`],
      ['Skill points', `${h.skillPoints}`],
      ['Kills', `${h.kills}`],
    ];
    const html = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (this.stats.innerHTML !== html) this.stats.innerHTML = html;

    for (const slot of GEAR_SLOTS) {
      const g = h.equipment[slot];
      this.renderSlot(this.gearSlots.get(slot)!, g ? { icon: g.icon, tier: g.tier, name: g.name } : null);
    }
    h.inventory.slots.forEach((s, i) => {
      const b = this.bagSlots[i];
      if (!s) this.renderSlot(b, null);
      else if (s.kind === 'stack') this.renderSlot(b, { icon: ITEMS[s.id].icon, count: s.count, name: ITEMS[s.id].name });
      else this.renderSlot(b, { icon: s.gear.icon, tier: s.gear.tier, name: s.gear.name });
    });
  }
}
