import { Ability, Channel } from '../abilities/Ability';
import { SearingArrows, rangerKit } from '../abilities/rangerAbilities';
import { TILE } from '../world/map';
import { PROPS } from '../world/props';
import { heroDamage } from './balance';
import type { HeroSave } from '../save';
import { EMPTY_STATS, Gear, GearSlot, GearStats, Inventory, ItemId, TOMES, TomeId, addStats } from './items';
import { Order, Unit, World } from './Unit';

import { MAX_LEVEL, xpForLevel } from './xp';

export { MAX_LEVEL, xpForLevel };

export class Hero extends Unit {
  level = 1;
  xp = 0;
  skillPoints = 1;
  mana: number;
  readonly abilities: Ability[] = rangerKit();

  readonly inventory = new Inventory();
  readonly equipment: Partial<Record<GearSlot, Gear>> = {};
  /** Sum of worn gear stats, recomputed on equip. */
  gear: GearStats = { ...EMPTY_STATS };
  kills = 0;
  /** Permanent bonuses from tomes. */
  readonly bonus = { hp: 0, mana: 0, damage: 0, speed: 0 };
  private potionCd = 0;

  private baseMaxHp = 420;
  private baseMaxMana = 220;

  private castT = 0;
  private castStarted = false;
  private channel: { c: Channel; t: number } | null = null;
  private dash: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number } | null = null;
  private empowered: { mult: number; t: number } | null = null;

  respawnT = 0;

  constructor(world: World, x: number, y: number) {
    super(world, 'player', 'archer', {
      maxHp: 420,
      speed: 46,
      radius: 5,
      attackRange: 6 * TILE,
      damage: heroDamage(1),
      attackCooldown: 1.1,
      damagePoint: 0.25,
      backswing: 0.35,
      acquireRange: 7 * TILE,
      ranged: true,
      barHeight: 27,
      spriteScale: 0.5,
    }, x, y);
    this.mana = this.maxMana;
    // TEST MODE: every ability maxed from the start. Remove when the abilities are signed off.
    for (const ab of this.abilities) ab.level = ab.maxLevel;
    (this.abilities[0] as SearingArrows).autocast = true;
    this.skillPoints = 0;
  }

  get maxHp(): number {
    return this.baseMaxHp + (this.level - 1) * 45 + this.bonus.hp + this.gear.hp;
  }
  get maxMana(): number {
    return this.baseMaxMana + (this.level - 1) * 18 + this.bonus.mana + this.gear.mana;
  }
  get speed(): number {
    return this.stats.speed + this.bonus.speed + this.gear.speed;
  }
  get armor(): number {
    return this.gear.armor;
  }
  get attackCooldown(): number {
    return this.stats.attackCooldown / (1 + this.gear.attackSpeed / 100);
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
    if (!entry || entry.kind !== 'gear') return 'Nothing to equip';
    const worn = this.equipment[entry.gear.slot];
    this.equipment[entry.gear.slot] = entry.gear;
    this.inventory.slots[index] = worn ? { kind: 'gear', gear: worn } : null;
    this.recomputeGear();
    return null;
  }

  /** Take a worn piece off into the bag. */
  unequip(slot: GearSlot): string | null {
    const worn = this.equipment[slot];
    if (!worn) return 'Nothing worn there';
    if (!this.inventory.addGear(worn)) return 'Bag is full';
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
    return 1.2 + this.level * 0.25 + this.gear.hpRegen;
  }
  get manaRegen(): number {
    return 1.4 + this.level * 0.2 + this.gear.manaRegen;
  }

  get damageRange(): [number, number] {
    const [a, b] = heroDamage(this.level);
    return [a + this.bonus.damage + this.gear.damage, b + this.bonus.damage + this.gear.damage];
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
    if (x === undefined || y === undefined) return 'Needs a target';
    this.issue({ type: 'cast', ability: ab, x, y }, queued);
    return null;
  }

  dashTo(x: number, y: number, dur: number): void {
    this.dash = { fx: this.x, fy: this.y, tx: x, ty: y, t: 0, dur };
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

  /** Will the next attack be a Searing (magic) shot? */
  private get searingReady(): boolean {
    const searing = this.abilities[0] as SearingArrows;
    return searing.level > 0 && searing.autocast && this.mana >= searing.manaCost();
  }

  /** Sky-arrow cast pose while channelling Rain of Arrows: raise the bow, then hold, mirrored by facing. */
  private channelFrame(): string | null {
    if (!this.channel) return null;
    const t = this.channel.t;
    const i = t < 0.15 ? 5 : t < 0.3 ? 6 : t < 0.45 ? 7 : t < 0.6 ? 8 : 9;
    return `skycast_${i}`;
  }

  /** Magic-shot cast frames follow the swing: frames 0-2 over the windup, 3 on release. */
  private castFrame(): string | null {
    if (!this.swing || !this.searingReady) return null;
    const { facing } = this.facing;
    if (this.swing.phase === 'backswing') return `cast_${facing}_3`;
    const windup = this.windupTime();
    const p = windup > 0 ? 1 - this.swing.t / windup : 1;
    return `cast_${facing}_${Math.min(2, Math.floor(p * 3))}`;
  }

  protected syncSprite(dt: number): void {
    const chan = this.channelFrame();
    const cast = chan ? null : this.castFrame();
    this.frameOverride = chan ? { atlas: 'sky', frame: chan } : cast ? { atlas: 'magic', frame: cast } : null;
    super.syncSprite(dt);
  }

  protected releaseAttack(target: Unit): void {
    let dmg = this.rollDamage();
    let fire = false;
    const searing = this.abilities[0] as SearingArrows;
    if (searing.level > 0 && searing.autocast && this.mana >= searing.manaCost()) {
      this.mana -= searing.manaCost();
      dmg += searing.bonus();
      fire = true;
    }
    if (this.empowered) {
      dmg = Math.round(dmg * this.empowered.mult);
      this.empowered = null;
    }
    if (fire) this.world.fireMagicBolt(this, target, dmg);
    else this.world.fireArrow(this, target, dmg, false);
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
    else super.runOrder(dt);
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

    let tx = o.x;
    let ty = o.y;
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
    const off = this.turnToward(Math.atan2(ty - this.y, tx - this.x), dt);
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
      this.sprite.setY(Math.round(this.y + 3 - Math.sin(p * Math.PI) * 5));
      if (Math.random() < 0.6) this.world.burst(this.x, this.y, 0x9be08a, 1);
      if (p >= 1) this.dash = null;
      this.moving = true;
      this.syncSprite(dt);
      if (this.dash) this.sprite.setY(Math.round(this.y + 3 - Math.sin(p * Math.PI) * 5));
      return;
    }
    super.update(dt);
  }

  die(): void {
    if (this.channel) this.onOrderInterrupted();
    this.dash = null;
    this.empowered = null;
    super.die();
    this.respawnT = 6 + this.level * 1.5;
  }

  revive(x: number, y: number): void {
    super.revive(x, y);
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

  /** Everything a checkpoint needs to bring this hero back. */
  serialize(): HeroSave {
    return {
      level: this.level,
      xp: this.xp,
      skillPoints: this.skillPoints,
      abilities: this.abilities.map((a) => ({ level: a.level, autocast: a instanceof SearingArrows ? a.autocast : undefined })),
      bonus: { ...this.bonus },
      kills: this.kills,
      equipment: JSON.parse(JSON.stringify(this.equipment)),
      bag: JSON.parse(JSON.stringify(this.inventory.slots)),
    };
  }

  /** Restore from a checkpoint (full health and mana, as after a rest at the beacon). */
  restore(s: HeroSave): void {
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
    for (const k of Object.keys(this.equipment) as GearSlot[]) delete this.equipment[k];
    Object.assign(this.equipment, s.equipment);
    s.bag.forEach((e, i) => (this.inventory.slots[i] = e));
    this.recomputeGear();
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }
}
