/**
 * Legitimate sites that the lookalike rule would flag. Seeded as `allow` with the
 * official domains; staff can still block them. They are not protected brands.
 */
export const KNOWN_SAFE_DOMAINS: readonly string[] = [
  'discord.js.org',
  'discordjs.dev',
  'steamdb.info',
  'steamcharts.com',
  'disboard.org',
  'discogs.com',
];
