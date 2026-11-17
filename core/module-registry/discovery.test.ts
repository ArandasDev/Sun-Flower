import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverModules } from './discovery.ts';

function manifest(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    description: 'Test module',
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies: [],
    permissions: [],
    capabilities: [],
  };
}

let root: string;

function write(directory: string, content: string): void {
  const dir = path.join(root, directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-flower-discovery-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('discoverModules', () => {
  it('returns [] when the modules directory does not exist', () => {
    expect(discoverModules(path.join(root, 'missing'), '1.0.0')).toEqual([]);
  });

  it('discovers valid modules and ignores directories without manifest.json', () => {
    write('ping', JSON.stringify(manifest('ping')));
    fs.mkdirSync(path.join(root, 'empty'));
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
    const result = discoverModules(root, '1.0.0');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      directory: path.join(root, 'ping'),
      directoryName: 'ping',
      errors: [],
      manifest: { id: 'ping' },
    });
  });

  it('marks malformed JSON without affecting other modules', () => {
    write('broken', '{ not json');
    write('ping', JSON.stringify(manifest('ping')));
    const result = discoverModules(root, '1.0.0');
    const broken = result.find((m) => m.directoryName === 'broken');
    const ping = result.find((m) => m.directoryName === 'ping');
    expect(broken?.errors).toEqual(['manifest.json is not valid JSON']);
    expect(broken?.manifest).toBeUndefined();
    expect(ping?.errors).toEqual([]);
    expect(ping?.manifest?.id).toBe('ping');
  });

  it('reports validation errors for invalid manifests', () => {
    write('ping', JSON.stringify({ ...manifest('ping'), version: 'x' }));
    const [mod] = discoverModules(root, '1.0.0');
    expect(mod?.manifest).toBeUndefined();
    expect(mod?.errors.join(' ')).toMatch(/version/);
  });

  it('rejects every module sharing a duplicated id', () => {
    write('ping', JSON.stringify(manifest('ping')));
    write('pong', JSON.stringify(manifest('ping')));
    write('other', JSON.stringify(manifest('other')));
    const result = discoverModules(root, '1.0.0');
    for (const name of ['ping', 'pong']) {
      const mod = result.find((m) => m.directoryName === name);
      expect(mod?.errors).toContain('duplicate module id "ping"');
      expect(mod?.manifest).toBeUndefined();
    }
    expect(result.find((m) => m.directoryName === 'other')?.errors).toEqual([]);
  });
});
