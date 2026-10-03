import type { CreepKind } from './balance';
import type { GearSlot, TomeId } from './items';

/** Villagers of Elderglade (the village around the moonwell at the start). */
export type NpcId = 'elder' | 'merchant' | 'smith' | 'warden';

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  /** Their sprite: a frame of the town atlas. */
  sprite: string;
  greeting: string;
  /** What they sell, if they trade: general goods (potions, trinkets) or the smith's arms and armour. */
  vendor?: 'goods' | 'smith';
}

export const NPCS: Record<NpcId, NpcDef> = {
  elder: {
    id: 'elder',
    name: 'Elder Maelis',
    title: 'Keeper of the Moonwell',
    sprite: 'npc_mage',
    greeting: 'The moonwell still sings, Ranger, but the woods around it have grown restless. Rest here whenever you need: its waters will mend you.',
  },
  merchant: {
    id: 'merchant',
    name: 'Tamsin',
    title: 'Merchant',
    sprite: 'npc_red',
    vendor: 'goods',
    greeting: 'Potions, rings, amulets, cloaks: a bit of everything! Coin is coin, Ranger, and I pay fair for what you bring back from the wilds.',
  },
  smith: {
    id: 'smith',
    name: 'Brann',
    title: 'Blacksmith',
    sprite: 'npc_smith',
    vendor: 'smith',
    greeting: "Bows, mail, helms and boots: if it's steel or leather, I made it. Mind the forge, it bites. Got something you don't need? I'll buy it.",
  },
  warden: {
    id: 'warden',
    name: 'Warden Corin',
    title: 'Captain of the Watch',
    sprite: 'npc_guard',
    greeting: 'Stay sharp out there. The roads are ours by day; the old gates in the hills belong to something else.',
  },
};

export type QuestId = 'arrival' | 'tusks' | 'bones' | 'darkness' | 'thanks' | 'alpha' | 'deeper';

export type Objective =
  /** Speak with the quest's turn-in villager (done as soon as it's accepted). */
  | { kind: 'talk'; label: string }
  | { kind: 'kill'; creep: CreepKind; count: number; label: string }
  /** Beat a dungeon's boss room (its guard pack). */
  | { kind: 'dungeonBoss'; count: number; label: string }
  /** Reach a dungeon floor this deep. */
  | { kind: 'depth'; depth: number; label: string };

export interface QuestReward {
  xp: number;
  gold: number;
  potions?: number;
  /** A piece of gear at the hero's level, of this quality (and slot, if given). */
  gear?: { tier: number; slot?: GearSlot };
  tome?: TomeId;
}

export interface QuestDef {
  id: QuestId;
  title: string;
  giver: NpcId;
  turnIn: NpcId;
  /** Needs this quest done first. */
  requires?: QuestId;
  /** Part of the intro quest line (shown first in the dialog). */
  intro?: boolean;
  offer: string;
  progress: string;
  complete: string;
  objective: Objective;
  reward: QuestReward;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'arrival',
    title: 'A Ranger Arrives',
    giver: 'elder',
    turnIn: 'merchant',
    intro: true,
    offer:
      'So the Ranger has come at last. Welcome to Elderglade. Before you go into the woods, you will need supplies: find Tamsin at the market, west of the moonwell. Tell her I sent you.',
    progress: 'Tamsin keeps her stall west of the moonwell.',
    complete: "The Elder sent you? Then you're family. Here: potions, on the house. You'll be back for more, I'd wager.",
    objective: { kind: 'talk', label: 'Speak with Tamsin at the market' },
    reward: { xp: 60, gold: 25, potions: 3 },
  },
  {
    id: 'tusks',
    title: 'Tusks for Trade',
    giver: 'merchant',
    turnIn: 'merchant',
    requires: 'arrival',
    intro: true,
    offer:
      "The boars have been raiding the fields, and boar tusk fetches a good price in the city. Hunt five of them for me. They hit hard up close, so strike first and don't let them surround you.",
    progress: 'Five boars, Ranger. They roam the clearings around the village.',
    complete: 'Fine tusks! A deal is a deal. And take this: it came in with the last caravan, and it will serve you better than it serves my shelf.',
    objective: { kind: 'kill', creep: 'boar', count: 5, label: 'Boars slain' },
    reward: { xp: 150, gold: 40, gear: { tier: 1, slot: 'quiver' } },
  },
  {
    id: 'bones',
    title: 'Restless Bones',
    giver: 'elder',
    turnIn: 'warden',
    requires: 'tusks',
    intro: true,
    offer:
      'The dead walk in the old ruins beyond the fields. Something stirs them from below. Put eight of them back to rest, then report to Warden Corin by the south gate.',
    progress: 'Eight of the restless dead, Ranger. Then go to Warden Corin.',
    complete: "The Elder said you'd be good. I didn't think you'd be that good. Take this: the finest weapon in our armoury, and better in your hands than on my wall.",
    objective: { kind: 'kill', creep: 'skeleton', count: 8, label: 'Skeletons put to rest' },
    reward: { xp: 300, gold: 60, gear: { tier: 1, slot: 'bow' } },
  },
  {
    id: 'darkness',
    title: 'Into the Dark',
    giver: 'warden',
    turnIn: 'warden',
    requires: 'bones',
    intro: true,
    offer:
      "Those skeletons crawl out of the old gates in the hills: stone doorways leading down into crypts. Go through one, fight your way to its deepest chamber and destroy the guardians there. Bring a torch... well. Bring potions.",
    progress: 'The gates are on the minimap: purple marks. Find the guardians in the deepest room.',
    complete: "You went down there and came back. That's more than the last three I sent. The village owes you, Ranger.",
    objective: { kind: 'dungeonBoss', count: 1, label: 'Dungeon guardians destroyed' },
    reward: { xp: 600, gold: 120, gear: { tier: 3 } },
  },
  {
    id: 'thanks',
    title: "The Elder's Thanks",
    giver: 'warden',
    turnIn: 'elder',
    requires: 'darkness',
    intro: true,
    offer: 'The Elder will want to hear this from you. Go on, she is by the moonwell.',
    progress: 'Elder Maelis is by the moonwell.',
    complete:
      'The dead sleep a little easier tonight. Take this tome, and my blessing. The gates go deeper than any of us know, Ranger. When you are ready, the rest of the wilds are yours.',
    objective: { kind: 'talk', label: 'Return to Elder Maelis' },
    reward: { xp: 200, gold: 100, tome: 'power' },
  },
  {
    id: 'alpha',
    title: 'Alpha Hunt',
    giver: 'warden',
    turnIn: 'warden',
    requires: 'bones',
    offer: 'Some boar packs follow an alpha: twice the size, three times the temper. Bring one down and my watchmen can sleep at night.',
    progress: 'Alphas lead the bigger boar packs further from the village.',
    complete: 'That beast terrorised the east road for a month. Well hunted.',
    objective: { kind: 'kill', creep: 'alphaBoar', count: 1, label: 'Alpha boars slain' },
    reward: { xp: 350, gold: 80, gear: { tier: 2 } },
  },
  {
    id: 'deeper',
    title: 'Deeper Still',
    giver: 'warden',
    turnIn: 'warden',
    requires: 'darkness',
    offer: 'Every crypt has a rune portal in its deepest chamber, leading further down. Scouts say the third floor is where the real danger starts. Go and see.',
    progress: 'Take the rune portals down until you reach the third floor of a crypt.',
    complete: 'The third floor... and back alive. I will have the scribes write this down.',
    objective: { kind: 'depth', depth: 3, label: 'Crypt floor 3 reached' },
    reward: { xp: 900, gold: 150, gear: { tier: 3 } },
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<QuestId, QuestDef>;

/** How much an objective needs (talk objectives need nothing). */
export function objectiveTarget(o: Objective): number {
  return o.kind === 'talk' ? 0 : o.kind === 'depth' ? 1 : o.count;
}

/** A villager's marker over their head: available quest, ready to hand in, or in progress. */
export type QuestMarker = 'available' | 'ready' | 'progress' | null;

/** The hero's quests: what's active (with progress), what's done. Lives for the whole run. */
export class QuestLog {
  readonly active = new Map<QuestId, number>();
  readonly done = new Set<QuestId>();

  /** Quests this villager can offer now. Intro quests first. */
  available(npc: NpcId): QuestDef[] {
    return QUESTS.filter((q) => q.giver === npc && !this.active.has(q.id) && !this.done.has(q.id) && (!q.requires || this.done.has(q.requires))).sort(
      (a, b) => Number(!!b.intro) - Number(!!a.intro),
    );
  }

  /** Active quests that this villager takes back. */
  handInsAt(npc: NpcId): QuestDef[] {
    return [...this.active.keys()].map((id) => QUEST_BY_ID[id]).filter((q) => q.turnIn === npc);
  }

  progress(id: QuestId): number {
    return this.active.get(id) ?? 0;
  }

  isComplete(id: QuestId): boolean {
    const q = QUEST_BY_ID[id];
    return this.active.has(id) && this.progress(id) >= objectiveTarget(q.objective);
  }

  accept(id: QuestId): boolean {
    const q = QUEST_BY_ID[id];
    if (!this.available(q.giver).includes(q)) return false;
    this.active.set(id, 0);
    return true;
  }

  /** Hand in a finished quest. Returns its reward, or null if it isn't finished. */
  complete(id: QuestId): QuestReward | null {
    if (!this.isComplete(id)) return null;
    this.active.delete(id);
    this.done.add(id);
    return QUEST_BY_ID[id].reward;
  }

  /** A creep died. Returns the quests that moved forward. */
  onKill(kind: CreepKind): QuestDef[] {
    return this.bump((o) => o.kind === 'kill' && o.creep === kind);
  }

  /** A dungeon boss room was cleared. */
  onDungeonBoss(): QuestDef[] {
    return this.bump((o) => o.kind === 'dungeonBoss');
  }

  /** Arrived on a dungeon floor this deep. */
  onDepth(depth: number): QuestDef[] {
    return this.bump((o) => o.kind === 'depth' && depth >= o.depth);
  }

  private bump(match: (o: Objective) => boolean): QuestDef[] {
    const moved: QuestDef[] = [];
    for (const [id, n] of this.active) {
      const q = QUEST_BY_ID[id];
      if (!match(q.objective) || n >= objectiveTarget(q.objective)) continue;
      this.active.set(id, n + 1);
      moved.push(q);
    }
    return moved;
  }

  marker(npc: NpcId): QuestMarker {
    if (this.handInsAt(npc).some((q) => this.isComplete(q.id))) return 'ready';
    if (this.available(npc).length) return 'available';
    if (this.handInsAt(npc).length) return 'progress';
    return null;
  }

  /** One line for the tracker: the objective with progress, or who to return to. */
  status(id: QuestId): string {
    const q = QUEST_BY_ID[id];
    if (this.isComplete(id)) return q.objective.kind === 'talk' ? q.objective.label : `Return to ${NPCS[q.turnIn].name}`;
    const o = q.objective;
    if (o.kind === 'talk') return o.label;
    if (o.kind === 'depth') return o.label.replace(/\d+/, `${o.depth}`);
    return `${o.label}: ${this.progress(id)}/${objectiveTarget(o)}`;
  }
}
