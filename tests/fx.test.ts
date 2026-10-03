import { describe, expect, it } from 'vitest';
import rangerfx from '../src/assets/sprites/rangerfx.json';
import auras from '../src/assets/sprites/auras.json';
import { AURAS } from '../src/art/sprites';

describe('ranger FX atlases', () => {
  it('has every effect frame the game draws', () => {
    for (const f of [
      'ground_target', 'ground_debuff', 'ground_cone', 'ground_line', 'ground_aoe', 'ground_impact_0', 'ground_impact_1',
      'ground_heal', 'ground_buff', 'ground_death_1', 'levelup', 'winddash_0', 'winddash_1',
    ]) expect(rangerfx.frames).toHaveProperty(f);
  });

  it('has 12 frames of every aura loop, all the same size within a loop', () => {
    const frames = auras.frames as Record<string, { frame: { w: number; h: number } }>;
    for (const a of AURAS) {
      const row = a === 'nature' ? 'ground' : 'combined';
      const sizes = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const f = frames[`aura_${a}_${row}_${i}`];
        expect(f, `aura_${a}_${row}_${i}`).toBeDefined();
        sizes.add(`${f.frame.w}x${f.frame.h}`);
      }
      expect(sizes.size).toBe(1);
    }
    expect(frames).toHaveProperty('aura_precision_ground_10');
  });

  it('keeps the auras at the sheet scale (32px cells at 1x = 64px at 2x density)', () => {
    const f = (auras.frames as Record<string, { frame: { w: number } }>)['aura_focus_ground_0'].frame;
    expect(f.w).toBeLessThanOrEqual(64);
    expect(f.w).toBeGreaterThan(48);
  });
});
