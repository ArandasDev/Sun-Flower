const SNOWFLAKE_MAX = 2n ** 64n - 1n;

/** Same rule as the server: no leading zero, 17 to 20 digits, at most 2^64 - 1. */
export function isSnowflake(value: string): boolean {
  return /^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= SNOWFLAKE_MAX;
}
