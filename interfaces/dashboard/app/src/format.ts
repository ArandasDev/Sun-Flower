const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Uptime in Portuguese, with the two largest units: "3 d 4 h", "2 h 5 min", "5 min". */
export function formatUptime(ms: number): string {
  if (ms < MINUTE) return 'menos de 1 min';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
