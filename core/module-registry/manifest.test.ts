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
  capabilities: [],
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
    ['incompatible apiVersion', { ...base, apiVersion: '1.2.0' }, /apiVersion/],
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
    ['entrypoint escaping with ..', { ...base, entrypoint: '../x.ts' }, /entrypoint/],
    [
      'entrypoint escaping after normalising',
      { ...base, entrypoint: 'a/../../x.ts' },
      /entrypoint/,
    ],
    ['absolute POSIX entrypoint', { ...base, entrypoint: '/abs/x.ts' }, /entrypoint/],
    ['Windows drive entrypoint', { ...base, entrypoint: 'C:\\x.ts' }, /entrypoint/],
    ['Windows drive entrypoint with slash', { ...base, entrypoint: 'C:/x.ts' }, /entrypoint/],
    ['UNC entrypoint', { ...base, entrypoint: '\\\\server\\x.ts' }, /entrypoint/],
  ])('rejects %s', (_, raw, pattern) => {
    const result = validateManifest(raw, 'ping', '1.0.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toMatch(pattern);
  });

  it('rejects a module publishing a discord.* event', () => {
    const raw = {
      ...base,
      id: 'moderation',
      permissions: [],
      events: { subscribes: [], publishes: ['discord.message.created'] },
    };
    const result = validateManifest(raw, 'moderation', '1.0.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toMatch(
      /published event "discord.message.created" must start with "moderation."/,
    );
  });

  it('rejects the reserved id "core"', () => {
    const raw = { ...minimal, id: 'core' };
    const result = validateManifest(raw, 'core', '1.0.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toMatch(/"core" is reserved/);
  });

  it('accepts capabilities guild.moderate and guild.message', () => {
    const capabilities = ['guild.moderate', 'guild.message'];
    const result = validateManifest({ ...base, capabilities }, 'ping', '1.1.0');
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ manifest: { capabilities } });
  });

  it('defaults capabilities to an empty array', () => {
    expect(validateManifest(minimal, 'ping', '1.1.0')).toMatchObject({
      ok: true,
      manifest: { capabilities: [] },
    });
  });

  it('rejects an unknown capability', () => {
    const result = validateManifest({ ...base, capabilities: ['guild.nuke'] }, 'ping', '1.1.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toMatch(/capabilities/);
  });

  it('rejects the reserved id "discord"', () => {
    const result = validateManifest({ ...minimal, id: 'discord' }, 'discord', '1.1.0');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(' ')).toContain(
      'id "discord" is reserved for the Core',
    );
  });

  it('accepts apiVersion 1.0.0 against core 1.1.0', () => {
    expect(validateManifest(base, 'ping', '1.1.0').ok).toBe(true);
  });

  it('accepts apiVersion 1.1.0 against core 1.2.0', () => {
    expect(validateManifest({ ...base, apiVersion: '1.1.0' }, 'ping', '1.2.0').ok).toBe(true);
  });

  it('allows subscribing to events of other modules', () => {
    const raw = { ...base, events: { subscribes: ['other.x.created'], publishes: [] } };
    expect(validateManifest(raw, 'ping', '1.0.0').ok).toBe(true);
  });

  it('accepts a nested relative entrypoint', () => {
    expect(validateManifest({ ...base, entrypoint: 'src/index.ts' }, 'ping', '1.0.0').ok).toBe(
      true,
    );
  });

  it('defaults subscribes to [] when only publishes is given', () => {
    const raw = { ...minimal, events: { publishes: ['ping.item.created'] } };
    expect(validateManifest(raw, 'ping', '1.0.0')).toMatchObject({
      ok: true,
      manifest: { events: { subscribes: [], publishes: ['ping.item.created'] } },
    });
  });

  it('applies defaults', () => {
    expect(validateManifest(minimal, 'ping', '1.0.0')).toMatchObject({
      ok: true,
      manifest: { enabledByDefault: false, events: { subscribes: [], publishes: [] } },
    });
  });
});
