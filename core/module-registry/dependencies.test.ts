import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { resolveOrder } from './dependencies.ts';

function m(id: string, dependencies: readonly string[] = []): ModuleManifest {
  return {
    id,
    name: id,
    description: id,
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies,
    permissions: [],
    enabledByDefault: false,
    events: { subscribes: [], publishes: [] },
  };
}

describe('resolveOrder', () => {
  it('orders dependencies first', () => {
    expect(resolveOrder([m('c', ['b']), m('b', ['a']), m('a')]).order).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties alphabetically', () => {
    expect(resolveOrder([m('z'), m('b'), m('m', ['z']), m('a')]).order).toEqual([
      'a',
      'b',
      'z',
      'm',
    ]);
  });

  it('fails a module with a missing dependency and its dependents', () => {
    const r = resolveOrder([m('a', ['ghost']), m('b', ['a']), m('c')]);
    expect(r.order).toEqual(['c']);
    expect(r.failed.get('a')).toMatch(/missing dependency "ghost"/);
    expect(r.failed.get('b')).toMatch(/dependency "a" failed/);
  });

  it('fails every module in a cycle', () => {
    const r = resolveOrder([m('a', ['b']), m('b', ['a']), m('c')]);
    expect([...r.failed.keys()].sort()).toEqual(['a', 'b']);
    expect(r.failed.get('a')).toBe('circular dependency');
    expect(r.order).toEqual(['c']);
  });

  it('fails a module that depends on itself', () => {
    const r = resolveOrder([m('a', ['a']), m('b')]);
    expect(r.failed.get('a')).toBe('circular dependency');
    expect(r.order).toEqual(['b']);
  });

  it('fails dependents of a cycle transitively', () => {
    const r = resolveOrder([m('a', ['b']), m('b', ['a']), m('c', ['a']), m('d', ['c'])]);
    expect(r.order).toEqual([]);
    expect(r.failed.get('c')).toBe('dependency "a" failed');
    expect(r.failed.get('d')).toBe('dependency "c" failed');
  });

  it('tolerates a duplicated dependency', () => {
    expect(resolveOrder([m('b', ['a', 'a']), m('a')]).order).toEqual(['a', 'b']);
  });
});
