import { CLASSES, CLASS_IDS, ClassId } from '../entities/classes';
import { applyUiArt } from './pixelFrame';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

/** Bars on the cards, against the best of the three. */
const BARS: Array<{ label: string; value: (id: ClassId) => number; max: number; cls: string }> = [
  { label: 'Health', value: (id) => CLASSES[id].maxHp, max: 580, cls: 'hp' },
  { label: 'Mana', value: (id) => CLASSES[id].maxMana, max: 320, cls: 'mp' },
  { label: 'Damage', value: (id) => CLASSES[id].damageMult / CLASSES[id].attackCooldown, max: 1.15, cls: 'dmg' },
  { label: 'Range', value: (id) => CLASSES[id].attackRange, max: 96, cls: 'rng' },
];

/**
 * Choose your hero: three cards in the character page's pixel WoW frame, each with the hero's
 * portrait, role, a few lines of flavour, stat bars and the four abilities. Tap a card to select it,
 * then Begin (or tap the selected card again).
 */
export function showClassPick(
  parent: HTMLElement,
  portrait: (id: ClassId) => string,
  icon: (frame: string) => string,
  onPick: (id: ClassId) => void,
): HTMLElement {
  const root = el('div', 'class-pick', parent);
  applyUiArt(root);
  const panel = el('div', 'cp-panel', root);
  el('div', 'cp-title', panel).textContent = 'Choose your hero';
  el('div', 'cp-sub', panel).textContent = 'Elderglade needs a champion. Who answers the call?';
  const cards = el('div', 'cp-cards', panel);
  let selected: ClassId = 'ranger';
  const cardEls = new Map<ClassId, HTMLButtonElement>();
  const go = el('button', 'card-action cp-go', panel);
  const update = () => {
    for (const [id, c] of cardEls) c.classList.toggle('on', id === selected);
    go.textContent = `Begin as ${CLASSES[selected].hero} the ${CLASSES[selected].name}`;
  };
  for (const id of CLASS_IDS) {
    const def = CLASSES[id];
    const card = el('button', 'cp-card', cards);
    card.dataset.cls = id;
    const head = el('div', 'cp-head', card);
    const ring = el('div', 'cp-ring', head);
    const img = el('img', '', ring);
    img.src = portrait(id);
    img.alt = '';
    const names = el('div', 'cp-names', head);
    el('div', 'cp-name', names).textContent = def.name;
    el('div', 'cp-hero', names).textContent = `${def.hero} · ${def.role}`;
    el('div', 'cp-blurb', card).textContent = def.blurb;
    const bars = el('div', 'cp-bars', card);
    for (const b of BARS) {
      const row = el('div', 'cp-bar', bars);
      el('span', 'lbl', row).textContent = b.label;
      const track = el('span', `track ${b.cls}`, row);
      el('i', '', track).style.width = `${Math.round(Math.min(1, b.value(id) / b.max) * 100)}%`;
    }
    const kit = el('div', 'cp-kit', card);
    for (const ab of def.kit()) {
      const a = el('span', 'cp-ab', kit);
      const ai = el('img', '', a);
      ai.src = icon(ab.icon);
      ai.alt = '';
      a.title = `${ab.hotkey}: ${ab.name}`;
      el('span', 'cp-ab-name', a).textContent = ab.name;
    }
    card.addEventListener('click', () => {
      if (selected === id && card.classList.contains('on')) onPick(id);
      selected = id;
      update();
    });
    cardEls.set(id, card);
  }
  go.addEventListener('click', () => onPick(selected));
  update();
  return root;
}
