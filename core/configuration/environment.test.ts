import { describe, expect, it } from 'vitest';

import { EnvironmentError, loadDatabaseEnvironment, loadEnvironment } from './environment.ts';

const valid = { DISCORD_TOKEN: 'fake-token-value', DISCORD_GUILD_ID: '000000000000000000' };

describe('loadEnvironment', () => {
  it('applies defaults', () => {
    expect(loadEnvironment(valid)).toEqual({
      discordToken: 'fake-token-value',
      guildId: '000000000000000000',
      dbPath: 'data/sun-flower.db',
      logLevel: 'info',
    });
  });

  it('rejects missing and invalid variables without leaking values', () => {
    const run = () =>
      loadEnvironment({
        DISCORD_TOKEN: '',
        DISCORD_GUILD_ID: 'secret-guild-123',
        LOG_LEVEL: 'loud',
      });
    expect(run).toThrow(EnvironmentError);
    try {
      run();
    } catch (e) {
      const err = e as EnvironmentError;
      expect([...err.variables].sort()).toEqual(['DISCORD_GUILD_ID', 'DISCORD_TOKEN', 'LOG_LEVEL']);
      expect(err.message).not.toContain('secret-guild-123');
      expect(err.message).not.toContain('loud');
      expect(err.message).toContain('DISCORD_TOKEN');
    }
  });
});

describe('loadDatabaseEnvironment', () => {
  it('does not require Discord variables', () => {
    expect(loadDatabaseEnvironment({})).toEqual({
      dbPath: 'data/sun-flower.db',
      logLevel: 'info',
    });
  });

  it('treats empty strings as absent', () => {
    expect(loadDatabaseEnvironment({ SUNFLOWER_DB_PATH: '', LOG_LEVEL: '' })).toEqual({
      dbPath: 'data/sun-flower.db',
      logLevel: 'info',
    });
  });
});
