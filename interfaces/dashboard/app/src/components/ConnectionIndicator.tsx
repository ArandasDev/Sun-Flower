import { cn } from '../lib/utils.ts';
import { useLive } from '../live.ts';

/** The status text: retrying wins over a socket that is open but not yet stable. */
function statusText(connected: boolean, reconnecting: boolean): string {
  if (reconnecting) return 'Reconectando…';
  return connected ? 'Ao vivo' : 'Conectando…';
}

/** The live-connection state; the status region is always present, so each change is announced. */
export function ConnectionIndicator() {
  const { connected, reconnecting } = useLive();
  const live = connected && !reconnecting;
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-foreground">
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground')}
      />
      {statusText(connected, reconnecting)}
    </div>
  );
}
