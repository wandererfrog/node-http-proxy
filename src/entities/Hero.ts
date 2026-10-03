import { Ability, Channel } from '../abilities/Ability';
import { SearingArrows } from '../abilities/rangerAbilities';
import { CLASSES, ClassDef, ClassId } from './classes';
import type { AuraName } from '../art/sprites';
import { TILE } from '../world/map';
import { PROPS } from '../world/props';
import { heroDamage } from './balance';
import { EMPTY_STATS, Gear, GearSlot, GearStats, Inventory, ItemId, TOMES, TomeId, addStats, requiredLevel } from './items';
import { Order, Unit, World } from './Unit';
import { NO_TALENT_STATS, TALENT_VALUES as TV, TalentId, TalentStats, Talents } from './talents';
import type { InvEntry } from './items';

/** Everything about the hero that carries over between maps (overworld, dungeon floors). */
export interface HeroState {
  cls: ClassId;
  level: number;
  xp: number;
  skillPoints: number;
  abilities: Array<{ level: number; autocast?: boolean }>;
  bonus: { hp: number; mana: number; damage: number; speed: number };
  kills: number;
  gold: number;
  equipment: Partial<Record<GearSlot, Gear>>;
  bag: (InvEntry | null)[];
  potions: Record<ItemId, number>;
  talents: { ranks: Record<TalentId, number>; points: number };
  hp: number;
  mana: number;
}

import { MAX_LEVEL, xpForLevel } from './xp';

export { MAX_LEVEL, xpForLevel };

export class Hero extends Unit {
  level = 1;
  xp = 0;
  skillPoints = 1;
  mana: number;
  /** Ranger, Mage or Knight: stats, attack, abilities and talent tree. */
  readonly cls: ClassDef;
  readonly abilities: Ability[];

  readonly inventory = new Inventory();
  /** Talent tree: a point every second level, spent in the character page's Talents tab. */
  readonly talents: Talents;
  readonly equipment: Partial<Record<GearSlot, Gear>> = {};
  /** Sum of worn gear stats, recomputed on equip. */
  gear: GearStats = { ...EMPTY_STATS };
  kills = 0;
  /** Money for the village vendor: dropped by creeps, found in chests, paid by quests. */
  gold = 0;
  /** Permanent bonuses from tomes. */
  readonly bonus = { hp: 0, mana: 0, damage: 0, speed: 0 };
  private potionCd = 0;

  /** Arcane Shield: damage it can still soak, and seconds left. */
  absorbLeft = 0;
  absorbT = 0;
  /** Defender: fraction of damage taken off, and seconds left. */
  defendPct = 0;
  defendT = 0;
  /**
   * A move in progress (the Knight's bash, spin, leap, taunt): the light the scene draws over the
   * hero (`anim`, '' for none), how the hero's own sprite poses, and a counter so the scene can tell
   * a new move from the same one.
   */
  move: { anim: string; t: number; pose: 'spin' | 'swing' | 'guard'; id: number } | null = null;
  private moveCount = 0;

  private castT = 0;
  private castStarted = false;
  private channel: { c: Channel; t: number } | null = null;
  private dash: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number; hop: number } | null = null;
  private empowered: { mult: number; t: number } | null = null;

  respawnT = 0;

  constructor(world: World, x: number, y: number, cls: ClassId = 'ranger') {
    const def = CLASSES[cls];
    super(world, 'player', def.texture, {
      maxHp: def.maxHp,
      speed: def.speed,
      radius: 5,
      attackRange: def.attackRange,
      damage: heroDamage(1),
      attackCooldown: def.attackCooldown,
      damagePoint: def.damagePoint,
      backswing: def.backswing,
      acquireRange: 7 * TILE,
      ranged: def.attack !== 'melee',
      barHeight: 27,
      spriteScale: 0.5,
    }, x, y);
    this.cls = def;
    this.abilities = def.kit();
    this.talents = new Talents(cls);
    this.mana = this.maxMana;
  }

  private tsCache: { key: string; stats: TalentStats } = { key: '', stats: NO_TALENT_STATS };

  /** What the learned talents add (cached until a rank changes). */
  get talentStats(): TalentStats {
    const key = JSON.stringify(this.talents.ranks);
    if (key !== this.tsCache.key) this.tsCache = { key, stats: this.talents.stats() };
    return this.tsCache.stats;
  }

  get maxHp(): number {
    return this.cls.maxHp + (this.level - 1) * this.cls.hpPerLevel + this.bonus.hp + this.gear.hp + this.talentStats.hp;
  }
  get maxMana(): number {
    return this.cls.maxMana + (this.level - 1) * this.cls.manaPerLevel + this.bonus.mana + this.gear.mana + this.talentStats.mana;
  }
  get speed(): number {
    return (this.stats.speed + this.bonus.speed + this.gear.speed + this.talentStats.speed) * (this.slowT > 0 ? this.slowMult : 1);
  }
  get armor(): number {
    return this.cls.armor + this.gear.armor + this.talentStats.armor;
  }
  get attackCooldown(): number {
    const pct = this.gear.attackSpeed + this.talentStats.attackSpeed;
    return this.stats.attackCooldown / (1 + pct / 100);
  }
  get attackRange(): number {
    return this.stats.attackRange + this.talentStats.range;
  }

  private recomputeGear(): void {
    let g = { ...EMPTY_STATS };
    for (const item of Object.values(this.equipment)) if (item) g = addStats(g, item.stats);
    this.gear = g;
    this.hp = Math.min(this.hp, this.maxHp);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  /** Wear the gear in bag slot `index`; whatever was worn goes back into that slot. */
  equipFromBag(index: number): string | null {
    const entry = this.inventory.slots[index];
    if (!entry) return 'Nothing to equip';
    const req = requiredLevel(entry.gear);
    if (this.level < req) return `Requires level ${req}`;
    const worn = this.equipment[entry.gear.slot];
    this.equipment[entry.gear.slot] = entry.gear;
    this.inventory.slots[index] = worn ? { kind: 'gear', gear: worn } : null;
    this.recomputeGear();
    return null;
  }

  /** Take a worn piece off into the bag: into bag slot `toIndex` if given and empty, else the first free one. */
  unequip(slot: GearSlot, toIndex?: number): string | null {
    const worn = this.equipment[slot];
    if (!worn) return 'Nothing worn there';
    if (toIndex !== undefined && toIndex >= 0 && !this.inventory.slots[toIndex]) this.inventory.slots[toIndex] = { kind: 'gear', gear: worn };
    else if (!this.inventory.addGear(worn)) return 'Bag is full';
    delete this.equipment[slot];
    this.recomputeGear();
    return null;
  }

  /** Read a tome: permanent stat boost. Returns the line to show the player. */
  readTome(id: TomeId): string {
    if (id === 'vitality') {
      this.bonus.hp += 60;
      this.hp += 60;
    } else if (id === 'insight') {
      this.bonus.mana += 40;
      this.mana += 40;
    } else if (id === 'power') this.bonus.damage += 4;
    else this.bonus.speed += 3;
    return `${TOMES[id].name}: ${TOMES[id].effect}`;
  }
  get hpRegen(): number {
    return this.cls.hpRegen + this.level * 0.25 + this.gear.hpRegen + this.talentStats.hpRegen;
  }
  get manaRegen(): number {
    return this.cls.manaRegen + this.level * 0.2 + this.gear.manaRegen + this.talentStats.manaRegen;
  }

  get damageRange(): [number, number] {
    const [a, b] = heroDamage(this.level);
    const m = this.cls.damageMult;
    const flat = this.bonus.damage + this.gear.damage + this.talentStats.damage;
    return [Math.round(a * m) + flat, Math.round(b * m) + flat];
  }

  rollDamage(): number {
    const [a, b] = this.damageRange;
    return Math.round(a + Math.random() * (b - a));
  }

  /** Drink a potion. Returns an error message for the player, or null on success. */
  usePotion(id: ItemId): string | null {
    if (this.dead) return 'Dead';
    if (this.potionCd > 0) return null;
    if (id === 'hp_potion' && this.hp >= this.maxHp) return 'Already at full health';
    if (id === 'mp_potion' && this.mana >= this.maxMana) return 'Already at full mana';
    if (!this.inventory.takeOne(id)) return id === 'hp_potion' ? 'No healing potions' : 'No mana potions';
    this.potionCd = 0.6;
    if (id === 'hp_potion') {
      this.hp = Math.min(this.maxHp, this.hp + 220);
      this.world.floatText(this.x, this.y - 30, '+220', '#7dff6a', true);
      this.world.burst(this.x, this.y - 10, 0xff5a5a, 10);
    } else {
      this.mana = Math.min(this.maxMana, this.mana + 120);
      this.world.floatText(this.x, this.y - 30, '+120', '#8fb8ff', true);
      this.world.burst(this.x, this.y - 10, 0x5a8aff, 10);
    }
    return null;
  }

  get channelling(): boolean {
    return this.channel !== null;
  }

  get dashing(): boolean {
    return this.dash !== null;
  }

  get solid(): boolean {
    return !this.dash;
  }

  // --- Progression --------------------------------------------------------------------------

  gainXp(amount: number): boolean {
    if (this.level >= MAX_LEVEL) return false;
    this.xp += amount;
    let leveled = false;
    while (this.level < MAX_LEVEL && this.xp >= xpForLevel(this.level + 1)) {
      this.level++;
      this.skillPoints++;
      // A talent point every second level.
      if (this.level % 2 === 0) this.talents.points++;
      this.hp = Math.min(this.maxHp, this.hp + 45);
      this.mana = Math.min(this.maxMana, this.mana + 18);
      leveled = true;
    }
    return leveled;
  }

  learn(ab: Ability): boolean {
    if (!ab.canLearn(this)) return false;
    ab.level++;
    this.skillPoints--;
    if (ab instanceof SearingArrows && ab.level === 1) ab.autocast = true;
    return true;
  }

  // --- Class moves and buffs ----------------------------------------------------------------

  /** Start a move: `anim` (a cfx_* light, or '') over the hero for `seconds`, posing as `pose`. */
  playMove(anim: string, seconds: number, pose: 'spin' | 'swing' | 'guard' = 'swing'): void {
    this.move = { anim, t: seconds, pose, id: ++this.moveCount };
  }

  stopMove(): void {
    this.move = null;
  }

  /** Blink: be somewhere else, right now. */
  teleportTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.path = [];
    this.moving = false;
  }

  /** Arcane Shield: soak the next `amount` damage for `seconds`. */
  shieldUp(amount: number, seconds: number): void {
    this.absorbLeft = amount;
    this.absorbT = seconds;
  }

  /** Defender: take `pct` less damage for `seconds`. */
  defend(pct: number, seconds: number): void {
    this.defendPct = pct;
    this.defendT = seconds;
  }

  /** Damage the hero actually takes after Defender and the Arcane Shield (armour comes first). */
  mitigate(amount: number): number {
    if (this.defendT > 0) amount *= 1 - this.defendPct;
    if (this.absorbT > 0 && this.absorbLeft > 0) {
      const soaked = Math.min(this.absorbLeft, amount);
      this.absorbLeft -= soaked;
      amount -= soaked;
      if (this.absorbLeft <= 0) this.absorbT = 0;
    }
    return amount;
  }

  /** The aura of a learned aura talent (Trueshot, Brilliance, Devotion), shown around the hero. */
  get aura(): AuraName | null {
    return this.talents.aura;
  }

  // --- Abilities ----------------------------------------------------------------------------

  /** Returns an error message to show the player, or null if the order went through. */
  useAbility(ab: Ability, x?: number, y?: number, queued = false): string | null {
    const why = ab.blocked(this);
    if (ab.targeting === 'toggle') {
      if (ab.level === 0) return why;
      ab.cast(this, this.x, this.y);
      return null;
    }
    if (why) return why;
    // Spells around the hero go off where the hero stands, whatever was tapped.
    if (ab.targeting === 'self') {
      x = this.x;
      y = this.y;
    }
    if (x === undefined || y === undefined) return 'Needs a target';
    this.issue({ type: 'cast', ability: ab, x, y }, queued);
    return null;
  }

  /** Dash or leap to (x, y) over `dur` seconds, hopping `hop` px off the ground at the middle. */
  dashTo(x: number, y: number, dur: number, hop = 5): void {
    this.dash = { fx: this.x, fy: this.y, tx: x, ty: y, t: 0, dur, hop };
    this.angle = Math.atan2(y - this.y, x - this.x);
  }

  empower(mult: number, seconds: number): void {
    this.empowered = { mult, t: seconds };
    this.attackCd = 0;
  }

  get isEmpowered(): boolean {
    return this.empowered !== null;
  }

  protected windupTime(): number {
    return this.empowered ? 0.05 : super.windupTime();
  }

  /** During a move the hero holds its sword out (a swing), spins through every facing, or stands guard. */
  protected syncSprite(dt: number): void {
    const m = this.move;
    if (m && m.pose === 'spin') this.angle += dt * 16;
    super.syncSprite(dt);
    if (m && m.pose !== 'guard') {
      this.sprite.anims.stop();
      this.sprite.setFrame(`${this.facing.facing}_${m.pose === 'spin' ? 'attack' : 'shoot'}`);
    }
  }

  /** A copy of everything that should carry over to the next map. */
  snapshot(): HeroState {
    const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
    return {
      cls: this.cls.id,
      level: this.level,
      xp: this.xp,
      skillPoints: this.skillPoints,
      abilities: this.abilities.map((a) => ({ level: a.level, autocast: a instanceof SearingArrows ? a.autocast : undefined })),
      bonus: { ...this.bonus },
      kills: this.kills,
      gold: this.gold,
      equipment: copy(this.equipment),
      bag: copy(this.inventory.slots),
      potions: { ...this.inventory.potions },
      talents: { ranks: { ...this.talents.ranks }, points: this.talents.points },
      hp: this.hp,
      mana: this.mana,
    };
  }

  /** Become the hero described by `s` (used when arriving on a new map). */
  restore(s: HeroState): void {
    this.level = s.level;
    this.xp = s.xp;
    this.skillPoints = s.skillPoints;
    s.abilities.forEach((a, i) => {
      const ab = this.abilities[i];
      if (!ab) return;
      ab.level = a.level;
      if (ab instanceof SearingArrows && a.autocast !== undefined) ab.autocast = a.autocast;
    });
    Object.assign(this.bonus, s.bonus);
    this.kills = s.kills;
    this.gold = s.gold ?? 0;
    for (const k of Object.keys(this.equipment) as GearSlot[]) delete this.equipment[k];
    Object.assign(this.equipment, s.equipment);
    s.bag.forEach((e, i) => (this.inventory.slots[i] = e));
    Object.assign(this.inventory.potions, s.potions);
    Object.assign(this.talents.ranks, s.talents.ranks);
    this.talents.points = s.talents.points;
    this.recomputeGear();
    this.hp = Math.max(1, Math.min(this.maxHp, s.hp));
    this.mana = Math.min(this.maxMana, s.mana);
  }

  /** The Ranger's Searing Arrows, if this hero has them. */
  private get searing(): SearingArrows | null {
    const a = this.abilities[0];
    return a instanceof SearingArrows ? a : null;
  }

  /** Mana per Searing arrow, after the Searing Mastery talent. */
  get searingCost(): number {
    const searing = this.searing;
    return searing ? Math.max(0, searing.manaCost() - this.talents.rank('searingMastery') * TV.searingCost) : 0;
  }

  /** Will the next attack be a Searing (magic) shot? */
  private get searingReady(): boolean {
    const searing = this.searing;
    return !!searing && searing.level > 0 && searing.autocast && this.mana >= this.searingCost;
  }

  protected releaseAttack(target: Unit): void {
    let dmg = this.rollDamage();
    let fire = false;
    const searing = this.searing;
    if (searing && this.searingReady) {
      this.mana -= this.searingCost;
      dmg += searing.bonus() + this.talents.rank('searingMastery') * TV.searingDamage;
      fire = true;
    }
    if (this.empowered) {
      dmg = Math.round(dmg * this.empowered.mult);
      this.empowered = null;
    }
    const ts = this.talentStats;
    // Auras (Trueshot, Brilliance, Devotion) add a share of damage.
    if (ts.damagePct) dmg = Math.round(dmg * (1 + ts.damagePct));
    // Deadeye / Critical Mass / Crushing Blow: a chance for double damage (shown big, in gold).
    const crit = ts.crit > 0 && Math.random() < ts.crit;
    if (crit) dmg *= 2;
    if (this.cls.attack === 'arcane') this.world.fireArcaneBolt(this, target, dmg, crit);
    else if (this.cls.attack === 'melee') {
      if (this.gap(target) > this.attackRange + 8) return;
      this.world.damage(target, dmg, this, crit ? { color: '#ffd84a', big: true } : {});
      this.world.hitSpark(target.x + (this.x - target.x) * 0.3, target.y - 6);
    } else if (fire) this.world.fireMagicBolt(this, target, dmg, crit);
    else this.world.fireArrow(this, target, dmg, false, crit);
  }

  protected onOrderInterrupted(): void {
    if (this.channel) {
      this.channel.c.end?.();
      this.channel = null;
    }
    this.castStarted = false;
    this.searchT = 0;
    this.poseOverride = null;
  }

  private searchT = 0;

  protected runOrder(dt: number): void {
    if (this.order.type === 'search') this.runSearch(this.order, dt);
    else if (this.order.type === 'talk') this.runTalk(this.order, dt);
    else super.runOrder(dt);
  }

  /** Walk up to the villager, face them and start talking. */
  private runTalk(o: Extract<Order, { type: 'talk' }>, dt: number): void {
    const cx = (o.tx + 0.5) * TILE;
    const cy = (o.ty + 0.5) * TILE;
    const d = Math.hypot(cx - this.x, cy - this.y);
    if (d > TILE * 1.6) {
      this.chase(cx, cy, dt);
      if (this.path.length === 0 && !this.moving && d > TILE * 2.2) {
        this.world.floatText(this.x, this.y - 30, "Can't reach them", '#ffd84a');
        this.nextOrder();
      }
      return;
    }
    this.path = [];
    this.moving = false;
    this.angle = Math.atan2(cy - this.y, cx - this.x);
    this.world.talkTo(o.tx, o.ty);
    this.nextOrder();
  }

  /** Walk next to the rock, rummage for a moment, then break it. */
  private runSearch(o: Extract<Order, { type: 'search' }>, dt: number): void {
    // Aim for the middle of the prop (rocks can be two tiles wide) and stop within reach of it.
    const prop = this.world.map.props.get(o.ty * this.world.map.width + o.tx);
    const w = prop ? PROPS[prop.key].w : 1;
    const cx = (o.tx + w / 2) * TILE;
    const cy = (o.ty + 0.5) * TILE;
    const d = Math.hypot(cx - this.x, cy - this.y);
    const reach = TILE * (1.5 + (w - 1) / 2);
    if (d > reach) {
      this.searchT = 0;
      this.poseOverride = null;
      this.chase(cx, cy, dt);
      // Path exhausted but still not there: the rock can't be reached.
      if (this.path.length === 0 && !this.moving && d > reach + TILE * 0.5) {
        this.world.floatText(this.x, this.y - 30, "Can't reach that", '#ffd84a');
        this.nextOrder();
      }
      return;
    }
    this.path = [];
    this.moving = false;
    this.turnToward(Math.atan2(cy - this.y, cx - this.x), dt);
    this.poseOverride = 'attack';
    this.searchT += dt;
    if (this.searchT >= 0.6) {
      this.searchT = 0;
      this.poseOverride = null;
      this.world.searchRock(o.tx, o.ty);
      this.nextOrder();
    }
  }

  protected runCast(o: Extract<Order, { type: 'cast' }>, dt: number): void {
    const ab = o.ability;
    if (this.channel) {
      this.channel.t += dt;
      this.channel.c.update(dt);
      if (this.channel.t >= this.channel.c.duration) {
        this.channel.c.end?.();
        this.channel = null;
        this.poseOverride = null;
        this.nextOrder();
      }
      return;
    }

    let tx = ab.targeting === 'self' ? this.x : o.x;
    let ty = ab.targeting === 'self' ? this.y : o.y;
    const d = Math.hypot(tx - this.x, ty - this.y);
    const range = ab.castRange();
    if (d > range) {
      if (ab.clampToRange) {
        tx = this.x + ((tx - this.x) / d) * range;
        ty = this.y + ((ty - this.y) / d) * range;
      } else {
        // Walk into range first, then cast (WC3 behaviour).
        this.chase(o.x, o.y, dt);
        return;
      }
    }
    this.path = [];
    this.moving = false;
    // Spells around the hero (Frost Nova, Whirlwind...) don't need facing anywhere.
    const off = ab.targeting === 'self' ? 0 : this.turnToward(Math.atan2(ty - this.y, tx - this.x), dt);
    if (!this.castStarted) {
      if (off > Math.PI / 6) return;
      this.castStarted = true;
      this.castT = ab.castPoint;
    }
    this.castT -= dt;
    this.poseOverride = ab.castPoint > 0 ? 'attack' : null;
    if (this.castT > 0) return;

    this.castStarted = false;
    this.poseOverride = null;
    const why = ab.blocked(this);
    if (why) {
      this.world.floatText(this.x, this.y - 20, why, '#ffd84a');
      this.nextOrder();
      return;
    }
    this.mana -= ab.manaCost();
    ab.cd = ab.cooldown();
    const ch = ab.cast(this, tx, ty);
    if (ch) {
      this.channel = { c: ch, t: 0 };
      this.poseOverride = 'attack';
      return;
    }
    this.nextOrder();
  }

  update(dt: number): void {
    if (this.dead) {
      this.respawnT -= dt;
      return;
    }
    this.hp = Math.min(this.maxHp, this.hp + this.hpRegen * dt);
    this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt);
    for (const a of this.abilities) a.tick(dt);
    this.potionCd = Math.max(0, this.potionCd - dt);
    this.absorbT = Math.max(0, this.absorbT - dt);
    if (this.absorbT <= 0) this.absorbLeft = 0;
    this.defendT = Math.max(0, this.defendT - dt);
    if (this.move) {
      this.move.t -= dt;
      if (this.move.t <= 0) this.stopMove();
    }
    if (this.empowered) {
      this.empowered.t -= dt;
      if (this.empowered.t <= 0) this.empowered = null;
    }
    if (this.dash) {
      const k = this.dash;
      k.t += dt;
      const p = Math.min(1, k.t / k.dur);
      const e = 1 - (1 - p) * (1 - p);
      this.x = k.fx + (k.tx - k.fx) * e;
      this.y = k.fy + (k.ty - k.fy) * e;
      if (Math.random() < 0.6 && this.cls.id === 'ranger') this.world.burst(this.x, this.y, 0x9be08a, 1);
      const hop = k.hop;
      if (p >= 1) this.dash = null;
      this.moving = true;
      this.syncSprite(dt);
      if (this.dash) this.sprite.setY(Math.round(this.y + 3 - Math.sin(p * Math.PI) * hop));
      return;
    }
    super.update(dt);
  }

  die(): void {
    if (this.channel) this.onOrderInterrupted();
    this.dash = null;
    this.empowered = null;
    this.absorbT = 0;
    this.defendT = 0;
    this.stopMove();
    super.die();
    this.respawnT = 6 + this.level * 1.5;
  }

  revive(x: number, y: number): void {
    super.revive(x, y);
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }
}
