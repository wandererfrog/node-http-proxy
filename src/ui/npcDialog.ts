import type { Hero } from '../entities/Hero';
import { Gear, ITEMS, ItemId, SLOT_NAMES, TIERS, TOMES, describeStats, gearValue, requiredLevel } from '../entities/items';
import { NPCS, NpcDef, QUEST_BY_ID, QuestId, QuestLog } from '../entities/quests';
import { applyUiArt } from './pixelFrame';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

/** Something the merchant sells: potions (any number) or one piece of gear. */
export type StockItem = { kind: 'potion'; id: ItemId; price: number } | { kind: 'gear'; gear: Gear; price: number };

export interface DialogCallbacks {
  accept(id: QuestId): void;
  complete(id: QuestId): void;
  /** Buy stock item `index`. */
  buy(index: number): void;
  /** Sell the gear in bag slot `bagIndex`. */
  sell(bagIndex: number): void;
  close(): void;
}

type View = { kind: 'home' } | { kind: 'quest'; id: QuestId } | { kind: 'trade'; tab: 'buy' | 'sell' };

/**
 * Talking to a villager, in the character page's pixel WoW style: the portrait, a greeting, and
 * the quests they offer (gold !), the ones to hand in (gold ?) and those still in progress (grey ?).
 * A quest page shows the story, the objective and the rewards with Accept / Complete. The merchant
 * also has Trade: buy potions and gear, sell gear from the backpack.
 */
export class NpcDialog {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private npc: NpcDef | null = null;
  private portrait = '';
  private stock: StockItem[] = [];
  private view: View = { kind: 'home' };
  private renderKey = '';

  constructor(
    parent: HTMLElement,
    private readonly hero: Hero,
    private readonly quests: QuestLog,
    private readonly icon: (frame: string) => string,
    private readonly cb: DialogCallbacks,
  ) {
    this.root = el('div', 'npc-page hidden', parent);
    applyUiArt(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.cb.close();
    });
    this.panel = el('div', 'npc-panel', this.root);
    this.panel.setAttribute('role', 'dialog');
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Open on a villager; `questId` jumps straight to that quest (the intro does this). */
  open(npc: NpcDef, portrait: string, stock: StockItem[] = [], questId?: QuestId): void {
    this.npc = npc;
    this.portrait = portrait;
    this.stock = stock;
    this.view = questId ? { kind: 'quest', id: questId } : { kind: 'home' };
    this.root.classList.remove('hidden');
    this.render(true);
  }

  close(): void {
    this.root.classList.add('hidden');
    this.npc = null;
  }

  setStock(stock: StockItem[]): void {
    this.stock = stock;
    this.render(true);
  }

  /** Re-render if anything it shows changed (gold, bag, quest progress). Cheap to call every frame. */
  refresh(): void {
    if (this.isOpen) this.render(false);
  }

  private go(view: View): void {
    this.view = view;
    this.render(true);
  }

  private render(force: boolean): void {
    const npc = this.npc;
    if (!npc) return;
    const h = this.hero;
    const key = JSON.stringify([this.view, h.gold, h.level, h.inventory.slots.map((s) => s?.gear.name ?? ''), [...this.quests.active], [...this.quests.done], this.stock.length]);
    if (!force && key === this.renderKey) return;
    this.renderKey = key;
    const p = this.panel;
    p.innerHTML = '';
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `corner ${c}`, p);

    const head = el('div', 'npc-head', p);
    const ring = el('div', 'npc-ring', head);
    const img = el('img', '', ring);
    img.src = this.portrait;
    img.alt = '';
    const titles = el('div', 'npc-titles', head);
    el('div', 'npc-name', titles).textContent = npc.name;
    el('div', 'npc-title', titles).textContent = npc.title;
    el('div', 'npc-gold', head).innerHTML = `${h.gold}<i class="coin"></i>`;
    const x = el('button', 'char-close', head);
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => this.cb.close());

    const body = el('div', 'npc-body', p);
    if (this.view.kind === 'home') this.renderHome(body, npc);
    else if (this.view.kind === 'quest') this.renderQuest(body, this.view.id);
    else this.renderTrade(body, this.view.tab);
  }

  private renderHome(body: HTMLElement, npc: NpcDef): void {
    el('p', 'npc-text', body).textContent = npc.greeting;
    const list = el('div', 'npc-options', body);
    const option = (mark: string, cls: string, label: string, onClick: () => void) => {
      const b = el('button', `npc-option ${cls}`, list);
      el('span', 'mark', b).textContent = mark;
      el('span', '', b).textContent = label;
      b.addEventListener('click', onClick);
    };
    for (const q of this.quests.handInsAt(npc.id)) {
      const ready = this.quests.isComplete(q.id);
      option('?', ready ? 'ready' : 'progress', q.title, () => this.go({ kind: 'quest', id: q.id }));
    }
    for (const q of this.quests.available(npc.id)) option('!', 'available', q.title, () => this.go({ kind: 'quest', id: q.id }));
    if (npc.vendor) option('◆', 'trade', 'Trade', () => this.go({ kind: 'trade', tab: 'buy' }));
    option('', 'bye', 'Goodbye', () => this.cb.close());
  }

  private renderQuest(body: HTMLElement, id: QuestId): void {
    const q = QUEST_BY_ID[id];
    const log = this.quests;
    const active = log.active.has(id);
    const done = log.done.has(id);
    const ready = log.isComplete(id) && q.turnIn === this.npc?.id;
    el('div', 'npc-qtitle', body).textContent = q.title;
    el('p', 'npc-text', body).textContent = done ? q.complete : ready ? q.complete : active ? q.progress : q.offer;
    if (!done) {
      el('div', 'npc-sub', body).textContent = 'Objective';
      el('div', 'npc-objective', body).textContent = active ? log.status(id) : q.objective.label + (q.objective.kind === 'kill' ? ` (${q.objective.count})` : '');
    }
    el('div', 'npc-sub', body).textContent = 'Rewards';
    const r = q.reward;
    const rewards = el('div', 'npc-rewards', body);
    el('span', 'xp', rewards).textContent = `${r.xp} XP`;
    el('span', 'gold', rewards).innerHTML = `${r.gold}<i class="coin"></i>`;
    if (r.potions) el('span', '', rewards).textContent = `${r.potions} Healing Potions`;
    if (r.gear) {
      const t = TIERS[r.gear.tier];
      const s = el('span', '', rewards);
      s.style.color = t.color;
      s.textContent = `${t.rarity} ${r.gear.slot ? SLOT_NAMES[r.gear.slot].toLowerCase() : 'gear'}`;
    }
    if (r.tome) el('span', 'tome', rewards).textContent = TOMES[r.tome].name;
    const row = el('div', 'npc-actions', body);
    const back = el('button', 'npc-btn', row);
    back.textContent = 'Back';
    back.addEventListener('click', () => this.go({ kind: 'home' }));
    if (!active && !done) {
      const accept = el('button', 'card-action', row);
      accept.textContent = 'Accept';
      accept.addEventListener('click', () => {
        this.cb.accept(id);
        this.go({ kind: 'home' });
      });
    } else if (ready) {
      const complete = el('button', 'card-action', row);
      complete.textContent = 'Complete';
      complete.addEventListener('click', () => {
        this.cb.complete(id);
        this.go({ kind: 'home' });
      });
    }
  }

  private renderTrade(body: HTMLElement, tab: 'buy' | 'sell'): void {
    const tabs = el('div', 'npc-tabs', body);
    for (const [t, label] of [['buy', 'Buy'], ['sell', 'Sell']] as const) {
      const b = el('button', `char-tab${t === tab ? ' on' : ''}`, tabs);
      b.textContent = label;
      b.addEventListener('click', () => this.go({ kind: 'trade', tab: t }));
    }
    const back = el('button', 'npc-btn small', tabs);
    back.textContent = 'Back';
    back.addEventListener('click', () => this.go({ kind: 'home' }));
    const list = el('div', 'npc-goods', body);
    const h = this.hero;
    const row = (iconFrame: string, name: string, color: string, sub: string, price: number, action: string, enabled: boolean, onClick: () => void, tier?: number) => {
      const r = el('div', 'good', list);
      const slot = el('div', 'inv-slot filled', r);
      if (tier !== undefined) slot.style.setProperty('--glow', TIERS[tier].color);
      const ic = el('img', 'item', slot);
      ic.src = this.icon(iconFrame);
      ic.alt = '';
      const txt = el('div', 'good-txt', r);
      const n = el('div', 'good-name', txt);
      n.textContent = name;
      n.style.color = color;
      el('div', 'good-sub', txt).textContent = sub;
      el('div', 'good-price', r).innerHTML = `${price}<i class="coin"></i>`;
      const b = el('button', 'npc-btn buy', r);
      b.textContent = action;
      b.disabled = !enabled;
      b.addEventListener('click', onClick);
    };
    if (tab === 'buy') {
      this.stock.forEach((s, i) => {
        const affordable = h.gold >= s.price;
        if (s.kind === 'potion') {
          const def = ITEMS[s.id];
          const full = h.inventory.count(s.id) >= def.maxStack;
          row(def.icon, def.name, '#ffffff', `${def.description} (have ${h.inventory.count(s.id)}/${def.maxStack})`, s.price, 'Buy', affordable && !full, () => this.cb.buy(i));
        } else {
          const g = s.gear;
          const req = requiredLevel(g);
          const sub = `${describeStats(g.stats).join(', ')}${req > 1 ? ` · Req. level ${req}` : ''}`;
          row(g.icon, g.name, TIERS[g.tier].color, sub, s.price, 'Buy', affordable && h.inventory.firstFree() >= 0, () => this.cb.buy(i), g.tier);
        }
      });
    } else {
      const gear = h.inventory.slots.map((s, i) => ({ s, i })).filter((e) => e.s);
      if (gear.length === 0) el('p', 'npc-text', list).textContent = 'Nothing to sell: your backpack is empty.';
      for (const { s, i } of gear) {
        const g = s!.gear;
        row(g.icon, g.name, TIERS[g.tier].color, `${TIERS[g.tier].rarity} ${SLOT_NAMES[g.slot].toLowerCase()} · item level ${g.level}`, gearValue(g), 'Sell', true, () => this.cb.sell(i), g.tier);
      }
    }
  }
}

/** Display name of a villager. */
export const npcName = (id: keyof typeof NPCS) => NPCS[id].name;
