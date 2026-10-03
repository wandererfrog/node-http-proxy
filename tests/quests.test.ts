import { describe, expect, it } from 'vitest';
import { QUESTS, QUEST_BY_ID, QuestLog } from '../src/entities/quests';

describe('quest log', () => {
  it('starts with only the Elder offering the first intro quest', () => {
    const log = new QuestLog();
    expect(log.available('elder').map((q) => q.id)).toEqual(['arrival']);
    expect(log.available('merchant')).toEqual([]);
    expect(log.available('warden')).toEqual([]);
    expect(log.marker('elder')).toBe('available');
    expect(log.marker('merchant')).toBeNull();
  });

  it('runs the intro chain: talk, hunt, report, delve, thank', () => {
    const log = new QuestLog();
    expect(log.accept('arrival')).toBe(true);
    // A talk quest is done as soon as it's taken; hand it in at the merchant.
    expect(log.marker('merchant')).toBe('ready');
    expect(log.complete('arrival')).not.toBeNull();
    expect(log.accept('tusks')).toBe(true);
    for (let i = 0; i < 4; i++) log.onKill('boar');
    log.onKill('skeleton');
    expect(log.isComplete('tusks')).toBe(false);
    expect(log.status('tusks')).toBe('Boars slain: 4/5');
    log.onKill('boar');
    log.onKill('boar'); // extra kills don't overflow
    expect(log.progress('tusks')).toBe(5);
    expect(log.status('tusks')).toBe('Return to Tamsin');
    expect(log.complete('tusks')).not.toBeNull();
    expect(log.accept('bones')).toBe(true);
    for (let i = 0; i < 8; i++) log.onKill('skeleton');
    expect(log.handInsAt('warden').map((q) => q.id)).toEqual(['bones']);
    expect(log.complete('bones')).not.toBeNull();
    // The warden now offers the next intro quest first, then side quests.
    expect(log.available('warden').map((q) => q.id)).toEqual(['darkness', 'alpha']);
    log.accept('darkness');
    log.onDungeonBoss();
    expect(log.complete('darkness')).not.toBeNull();
    log.accept('thanks');
    expect(log.marker('elder')).toBe('ready');
    expect(log.complete('thanks')?.tome).toBe('power');
    expect(log.done.size).toBe(5);
  });

  it("won't accept a quest before its prerequisite, or hand in an unfinished one", () => {
    const log = new QuestLog();
    expect(log.accept('bones')).toBe(false);
    log.accept('arrival');
    log.complete('arrival');
    log.accept('tusks');
    expect(log.complete('tusks')).toBeNull();
  });

  it('depth objectives count once the floor is reached', () => {
    const log = new QuestLog();
    for (const id of ['arrival', 'tusks', 'bones', 'darkness'] as const) {
      log.active.set(id, 99);
      log.complete(id);
    }
    log.accept('deeper');
    log.onDepth(2);
    expect(log.isComplete('deeper')).toBe(false);
    log.onDepth(3);
    expect(log.isComplete('deeper')).toBe(true);
  });

  it('every quest names a real prerequisite and has a reward', () => {
    for (const q of QUESTS) {
      if (q.requires) expect(QUEST_BY_ID[q.requires]).toBeDefined();
      expect(q.reward.xp).toBeGreaterThan(0);
    }
  });
});
