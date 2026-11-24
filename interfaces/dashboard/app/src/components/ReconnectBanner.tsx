import { useLive } from '../live.ts';

/** A status region that is always present, so screen readers announce the text when it appears. */
export function ReconnectBanner() {
  const { reconnecting } = useLive();
  return (
    <div role="status" className="reconnect-banner">
      {reconnecting ? 'Reconectando…' : null}
    </div>
  );
}
