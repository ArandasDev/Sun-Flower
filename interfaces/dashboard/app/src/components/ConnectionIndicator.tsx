import { cn } from '../lib/utils.ts';
import { useLive } from '../live.ts';

/** The live-connection state; the status region is always present, so each change is announced. */
export function ConnectionIndicator() {
  const { reconnecting } = useLive();
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          reconnecting ? 'bg-muted-foreground' : 'bg-primary',
        )}
      />
      {reconnecting ? 'Reconectando…' : 'Ao vivo'}
    </div>
  );
}
