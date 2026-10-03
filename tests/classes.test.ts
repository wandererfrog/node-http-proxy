import { describe, expect, it } from 'vitest';
import { FACINGS, POSES } from '../src/art/sprites';
import mage from '../src/assets/sprites/mage.json';
import knight from '../src/assets/sprites/knight.json';
import classfx from '../src/assets/sprites/classfx.json';
import { CLASSES, CLASS_IDS } from '../src/entities/classes';

describe('hero classes', () => {
  it.each(CLASS_IDS)('%s: four abilities on Q W E R, the ultimate opens at levels 6 and 12', (id) => {
    const kit = CLASSES[id].kit();
    expect(kit.map((a) => a.hotkey)).toEqual(['Q', 'W', 'E', 'R']);
    const ult = kit[3];
    expect(ult.requiredHeroLevel(1)).toBe(6);
    expect(ult.requiredHeroLevel(2)).toBe(12);
    for (const a of kit.slice(0, 3)) expect(a.requiredHeroLevel(1)).toBe(1);
    for (const a of kit) {
      expect(a.describe(0).length).toBeGreaterThan(10);
      expect(a.describe(a.maxLevel).length).toBeGreaterThan(10);
    }
  });

  it('the knight is the toughest, the mage has the most mana, the knight fights up close', () => {
    expect(CLASSES.knight.maxHp).toBeGreaterThan(CLASSES.ranger.maxHp);
    expect(CLASSES.ranger.maxHp).toBeGreaterThan(CLASSES.mage.maxHp);
    expect(CLASSES.mage.maxMana).toBeGreaterThan(CLASSES.ranger.maxMana);
    expect(CLASSES.knight.attack).toBe('melee');
    expect(CLASSES.knight.attackRange).toBeLessThan(CLASSES.mage.attackRange);
  });
});

describe('class atlases', () => {
  it.each([
    ['mage', mage],
    ['knight', knight],
  ] as const)('%s: every facing has the engine poses and the 6-frame loops', (_, atlas) => {
    const frames = atlas.frames as Record<string, unknown>;
    for (const f of FACINGS) {
      for (const p of POSES) expect(frames).toHaveProperty(`${f}_${p}`);
      for (let i = 0; i < 6; i++) for (const g of ['idle', 'walk', 'death']) expect(frames).toHaveProperty(`${f}_${g}_${i}`);
    }
  });

  it('the spell effects are all there, and the knight\'s are pinned at his feet', () => {
    const frames = classfx.frames as Record<string, { pivot?: { x: number; y: number } }>;
    for (const [name, n] of [['bolt', 6], ['nova', 5], ['orb', 4], ['teleport', 5], ['bubble', 1], ['bash', 5], ['whirl', 5], ['leap', 6], ['block', 6], ['taunt', 6]] as const)
      for (let i = 0; i < n; i++) expect(frames).toHaveProperty(`${name}_${i}`);
    for (const k of ['bash_0', 'whirl_2', 'taunt_3']) {
      expect(frames[k].pivot!.y).toBeGreaterThan(0.5);
      expect(frames[k].pivot!.y).toBeLessThan(1.3); // the light can end above his feet
    }
  });
});
