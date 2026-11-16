import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.ts';

const base = {
  id: 'ping',
  name: 'Ping',
  description: 'Replies to ping',
  version: '1.0.0',
  apiVersion: '1.0.0',
  entrypoint: 'index.ts',
  enabledByDefault: true,
  dependencies: [],
  permissions: ['ping.command.use'],
  events: { subscribes: ['discord.message.created'], publishes: ['ping.reply.sent'] },
};

const minimal = {
  id: 'ping',
  name: 'Ping',
  description: 'Replies to ping',
  version: '1.0.0',
  apiVersion: '1.0.0',
  entrypoint: 'index.ts',
  dependencies: [],
  permissions: [],
};

function omit(key: keyof typeof base): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...base };
  delete copy[key];
  return copy;
}

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateManifest(base, 'ping', '1.0.0')).toEqual({ ok: true, manifest: base });
  });

  it.each([
    ['missing field', omit('name'), /name/],
    ['extra field', { ...base, extra: true }, /extra/],
    ['id differs from directory', { ...base, id: 'other' }, /directory/],
    ['id not kebab-case', { ...base, id: 'Ping_Mod' }, /id/],
    ['invalid version', { ...base, version: '1.0' }, /version/],
    ['incompatible apiVersion', { ...base, apiVersion: '1.1.0' }, /apiVersion/],
    ['permission without module prefix', { ...base, permissions: ['other.res.act'] }, /permission/],
    ['malformed permission', { ...base, permissions: ['ping.act'] }, /permission/],
    [
      'published event without module prefix',
      { ...base, events: { subscribes: [], publishes: ['other.x.created'] } },
      /event/,
    ],
    [
      'malformed subscribed event',
      { ...base, events: { subscribes: ['message'], publishes: [] } },
      /event/,
    ],
    ['non-object manifest', 'text', /manifest/],
  ])('rejects %s', (_, raw, pattern) => {
    const result = validateManifest(raw, 'ping', '1.0.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toMatch(pattern);
  });

  it('allows subscribing to events of other modules', () => {
    const raw = { ...base, events: { subscribes: ['other.x.created'], publishes: [] } };
    expect(validateManifest(raw, 'ping', '1.0.0').ok).toBe(true);
  });

  it('applies defaults', () => {
    expect(validateManifest(minimal, 'ping', '1.0.0')).toMatchObject({
      ok: true,
      manifest: { enabledByDefault: false, events: { subscribes: [], publishes: [] } },
    });
  });
});
