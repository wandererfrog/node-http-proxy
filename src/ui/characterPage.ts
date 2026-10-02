import { iconDataUrl } from '../art/sprites';
import { Hero, MAX_LEVEL, xpForLevel } from '../entities/Hero';
import { INVENTORY_SIZE, ITEMS, ItemId } from '../entities/items';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

/**
 * Hero sheet: stats on one side, the six WC3-style inventory slots on the other.
 * The game keeps running while it is open, like in Warcraft III.
 */
export class CharacterPage {
  readonly root: HTMLDivElement;
  private readonly stats: HTMLDListElement;
  private readonly title: HTMLDivElement;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly itemInfo: HTMLDivElement;
  private readonly icons: Partial<Record<ItemId, string>> = {};

  constructor(
    parent: HTMLElement,
    private readonly hero: Hero,
    portraitUrl: string,
    private readonly onUse: (id: ItemId) => void,
    private readonly onClose: () => void,
  ) {
    this.root = el('div', 'char-page hidden', parent);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.onClose();
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
    close.addEventListener('click', () => this.onClose());

    const body = el('div', 'char-body', panel);
    const left = el('section', 'char-stats', body);
    el('h3', '', left).textContent = 'Stats';
    this.stats = el('dl', '', left);

    const right = el('section', 'char-inv', body);
    el('h3', '', right).textContent = 'Inventory';
    const grid = el('div', 'inv-grid', right);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const b = el('button', 'inv-slot', grid);
      b.addEventListener('click', () => {
        const s = this.hero.inventory.slots[i];
        if (s) this.onUse(s.id);
      });
      b.addEventListener('pointerenter', () => this.describe(i));
      b.addEventListener('focus', () => this.describe(i));
      this.slots.push(b);
    }
    this.itemInfo = el('div', 'inv-info', right);
    this.itemInfo.textContent = 'Tap a potion to drink it. Search rocks to find more.';
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('hidden', !open);
    if (open) this.refresh();
  }

  private icon(id: ItemId): string {
    return (this.icons[id] ??= iconDataUrl(ITEMS[id].icon, 4));
  }

  private describe(i: number): void {
    const s = this.hero.inventory.slots[i];
    this.itemInfo.textContent = s ? `${ITEMS[s.id].name} (${s.count}): ${ITEMS[s.id].description}` : 'Empty slot';
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
      ['Attack speed', `${(1 / h.stats.attackCooldown).toFixed(2)} / s`],
      ['Range', `${Math.round(h.attackRange / 16)} tiles`],
      ['Move speed', `${h.speed}`],
      ['Skill points', `${h.skillPoints}`],
      ['Kills', `${h.kills}`],
    ];
    const html = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (this.stats.innerHTML !== html) this.stats.innerHTML = html;
    h.inventory.slots.forEach((s, i) => {
      const b = this.slots[i];
      const key = s ? `${s.id}:${s.count}` : '';
      if (b.dataset.key === key) return;
      b.dataset.key = key;
      b.innerHTML = s ? `<img src="${this.icon(s.id)}" alt="${ITEMS[s.id].name}"><span class="count">${s.count}</span>` : '';
      b.title = s ? `${ITEMS[s.id].name}: ${ITEMS[s.id].description}` : 'Empty';
    });
  }
}
