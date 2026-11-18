import { describe, expect, it } from 'vitest';

import { MultiChannelTracker } from '../detection/multi-channel.ts';

const WINDOW = 60_000;

describe('MultiChannelTracker', () => {
  it('counts distinct channels inside the window', () => {
    const tracker = new MultiChannelTracker();
    expect(tracker.record('a1', 'x.gift', 'c1', 1000, WINDOW)).toBe(1);
    expect(tracker.record('a1', 'x.gift', 'c2', 2000, WINDOW)).toBe(2);
    expect(tracker.record('a1', 'x.gift', 'c3', 3000, WINDOW)).toBe(3);
  });

  it('counts the same channel once', () => {
    const tracker = new MultiChannelTracker();
    tracker.record('a1', 'x.gift', 'c1', 1000, WINDOW);
    expect(tracker.record('a1', 'x.gift', 'c1', 2000, WINDOW)).toBe(1);
  });

  it('ignores other domains and other authors', () => {
    const tracker = new MultiChannelTracker();
    tracker.record('a1', 'x.gift', 'c1', 1000, WINDOW);
    tracker.record('a2', 'x.gift', 'c2', 1000, WINDOW);
    expect(tracker.record('a1', 'y.gift', 'c3', 1000, WINDOW)).toBe(1);
  });

  it('ignores entries outside the window', () => {
    const tracker = new MultiChannelTracker();
    tracker.record('a1', 'x.gift', 'c1', 0, WINDOW);
    tracker.record('a1', 'x.gift', 'c2', 1000, WINDOW);
    expect(tracker.record('a1', 'x.gift', 'c3', 60_500, WINDOW)).toBe(2);
    expect(tracker.record('a1', 'x.gift', 'c4', 200_000, WINDOW)).toBe(1);
  });

  it('evicts the least recently recorded author beyond maxAuthors', () => {
    const tracker = new MultiChannelTracker({ maxAuthors: 2 });
    tracker.record('a1', 'x.gift', 'c1', 1000, WINDOW);
    tracker.record('a2', 'x.gift', 'c1', 1000, WINDOW);
    tracker.record('a1', 'x.gift', 'c2', 1100, WINDOW);
    tracker.record('a3', 'x.gift', 'c1', 1200, WINDOW);
    expect(tracker.authorCount).toBe(2);
    // a1 was kept (recently recorded); a2 was evicted.
    expect(tracker.record('a1', 'x.gift', 'c3', 1300, WINDOW)).toBe(3);
    expect(tracker.record('a2', 'x.gift', 'c9', 1400, WINDOW)).toBe(1);
  });

  it('keeps at most maxEntries per author, dropping the oldest', () => {
    const tracker = new MultiChannelTracker({ maxEntries: 50 });
    for (let i = 0; i < 60; i += 1) {
      tracker.record('a1', 'x.gift', `c${String(i)}`, 1000 + i, WINDOW);
    }
    expect(tracker.record('a1', 'x.gift', 'c60', 1100, WINDOW)).toBe(50);
  });

  it('prunes expired entries and empty authors', () => {
    const tracker = new MultiChannelTracker();
    tracker.record('a1', 'x.gift', 'c1', 0, WINDOW);
    tracker.record('a2', 'x.gift', 'c1', 100_000, WINDOW);
    tracker.prune(120_000, WINDOW);
    expect(tracker.authorCount).toBe(1);
    tracker.prune(1_000_000, WINDOW);
    expect(tracker.authorCount).toBe(0);
  });
});

describe('MultiChannelTracker flooding', () => {
  it('survives repeated filler links from the same channel', () => {
    const tracker = new MultiChannelTracker();
    tracker.record('a1', 'golpe.gift', 'c1', 1000, WINDOW);
    tracker.record('a1', 'golpe.gift', 'c2', 1100, WINDOW);
    for (let msg = 0; msg < 3; msg += 1) {
      for (let i = 0; i < 20; i += 1) {
        tracker.record('a1', `filler${String(i)}.org`, 'c1', 2000 + msg * 100 + i, WINDOW);
      }
    }
    expect(tracker.record('a1', 'golpe.gift', 'c3', 3000, WINDOW)).toBe(3);
  });

  it('does not grow the entry count on same-channel repeats', () => {
    const tracker = new MultiChannelTracker({ maxEntries: 3 });
    tracker.record('a1', 'x.gift', 'c1', 1000, WINDOW);
    for (let i = 0; i < 20; i += 1) tracker.record('a1', 'y.gift', 'c2', 1100 + i, WINDOW);
    expect(tracker.record('a1', 'x.gift', 'c3', 2000, WINDOW)).toBe(2);
  });
});
