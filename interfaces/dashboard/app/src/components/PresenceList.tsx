import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { screenLabel } from '../labels.ts';
import { useLive, type PresenceUser } from '../live.ts';
import { useCurrentMe } from '../session.tsx';

const GOLDEN_ANGLE = (137.508 * Math.PI) / 180;
/** Seed head and avatar sizes in px; an avatar's centre stays inside the ring. */
const SIZE = 136;
const AVATAR = 28;
const MAX_CENTER_RADIUS = SIZE / 2 - AVATAR / 2 - 4;
const SPACING = 14;
const MAX_SEEDS = 24;
const SPRING = { type: 'spring', stiffness: 320, damping: 22 } as const;
const SEED_FACE =
  'block size-7 rounded-full bg-primary object-cover text-center text-sm leading-7 font-bold text-primary-foreground';

/** The smallest free slot for each person; people keep their slot while they stay online. */
function assignSlots(slots: Map<string, number>, users: readonly PresenceUser[]): void {
  const online = new Set(users.map((user) => user.userId));
  for (const id of [...slots.keys()]) if (!online.has(id)) slots.delete(id);
  const taken = new Set(slots.values());
  for (const user of users) {
    if (slots.has(user.userId)) continue;
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    taken.add(slot);
    slots.set(user.userId, slot);
  }
}

function Seed({ user, slot, spacing }: { user: PresenceUser; slot: number; spacing: number }) {
  const radius = spacing * Math.sqrt(slot);
  const x = radius * Math.cos(slot * GOLDEN_ANGLE);
  const y = radius * Math.sin(slot * GOLDEN_ANGLE);
  const label = `${user.name} — ${screenLabel(user.screen)}`;
  return (
    <motion.li
      className="group/seed absolute top-[calc(50%-14px)] left-[calc(50%-14px)] size-7 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      tabIndex={0}
      aria-label={label}
      initial={{ scale: 0, x, y }}
      animate={{ scale: 1, x, y }}
      exit={{ scale: 0 }}
      transition={SPRING}
    >
      {user.avatarUrl === null ? (
        <span className={SEED_FACE} aria-hidden="true">
          {[...user.name][0]?.toUpperCase() ?? '?'}
        </span>
      ) : (
        <img className={SEED_FACE} src={user.avatarUrl} alt="" width={AVATAR} height={AVATAR} />
      )}
      <span
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-50 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-0.5 text-sm whitespace-nowrap text-popover-foreground group-hover/seed:block group-focus-visible/seed:block"
      >
        {label}
      </span>
    </motion.li>
  );
}

/** Who is online and where, as a sunflower seed head: avatars on a golden-angle spiral. */
export function PresenceList() {
  const me = useCurrentMe();
  const { presence } = useLive();
  const slots = useRef(new Map<string, number>());

  if (me.permissions.length === 0 && me.level !== 'developer' && me.level !== 'owner') {
    return null;
  }
  const others = presence.filter((user) => user.userId !== me.id);
  const shown = others.slice(0, MAX_SEEDS);
  assignSlots(slots.current, shown);
  const highest = Math.max(1, ...shown.map((user) => slots.current.get(user.userId) ?? 0));
  const spacing = Math.min(SPACING, MAX_CENTER_RADIUS / Math.sqrt(highest));
  const hidden = others.length - shown.length;
  return (
    <div className="flex flex-col items-center gap-2">
      {others.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Só você por aqui agora.</p>
      ) : (
        <>
          <ul
            className="relative m-0 size-[136px] list-none rounded-full border-2 border-primary p-0"
            aria-label="Quem está online"
          >
            <AnimatePresence>
              {shown.map((user) => (
                <Seed
                  key={user.userId}
                  user={user}
                  slot={slots.current.get(user.userId) ?? 0}
                  spacing={spacing}
                />
              ))}
            </AnimatePresence>
          </ul>
          {hidden > 0 ? (
            <p className="m-0 text-sm text-muted-foreground">{`e mais ${hidden}`}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
