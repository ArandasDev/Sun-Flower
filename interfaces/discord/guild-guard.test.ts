import { describe, expect, it } from 'vitest';

import { isAllowedInteraction } from './guild-guard.ts';

const allowed = '000000000000000000';
const other = '111111111111111111';

describe('isAllowedInteraction', () => {
  it('accepts interactions from the allowed guild', () => {
    expect(isAllowedInteraction({ guildId: allowed }, allowed)).toBe(true);
  });

  it('ignores interactions from other guilds and DMs', () => {
    expect(isAllowedInteraction({ guildId: null }, allowed)).toBe(false);
    expect(isAllowedInteraction({ guildId: other }, allowed)).toBe(false);
  });
});
