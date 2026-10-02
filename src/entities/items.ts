/** Items the hero can carry. WC3-style: six inventory slots, potions stack. */

export type ItemId = 'hp_potion' | 'mp_potion';

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  description: string;
  maxStack: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hp_potion: {
    id: 'hp_potion',
    name: 'Healing Potion',
    icon: 'potion_hp',
    description: 'Restores 220 health.',
    maxStack: 9,
  },
  mp_potion: {
    id: 'mp_potion',
    name: 'Mana Potion',
    icon: 'potion_mp',
    description: 'Restores 120 mana.',
    maxStack: 9,
  },
};

export interface ItemStack {
  id: ItemId;
  count: number;
}

export const INVENTORY_SIZE = 6;

export class Inventory {
  readonly slots: (ItemStack | null)[] = Array(INVENTORY_SIZE).fill(null);

  /** Adds an item, stacking where possible. Returns false when the bag is full. */
  add(id: ItemId, count = 1): boolean {
    const def = ITEMS[id];
    let left = count;
    for (const s of this.slots) {
      if (s && s.id === id && s.count < def.maxStack) {
        const n = Math.min(left, def.maxStack - s.count);
        s.count += n;
        left -= n;
        if (left === 0) return true;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, def.maxStack);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    return left === 0;
  }

  count(id: ItemId): number {
    return this.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
  }

  /** Removes one of `id` (from the last stack first). Returns false if there was none. */
  takeOne(id: ItemId): boolean {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        s.count--;
        if (s.count <= 0) this.slots[i] = null;
        return true;
      }
    }
    return false;
  }
}
