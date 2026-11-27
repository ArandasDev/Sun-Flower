import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { Badge } from './ui/badge.tsx';

export type StatusTone = 'active' | 'inactive' | 'failed' | 'pending';

const DOT = {
  active: 'bg-primary',
  inactive: 'bg-muted-foreground',
  failed: 'bg-destructive',
  pending: 'border border-muted-foreground',
} as const;

/** A neutral badge with a dot: active, stopped or discarded, failed, or in transition. Colour stays off the text, so amber is kept for the main action. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn(tone === 'failed' && 'text-destructive')}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </Badge>
  );
}
