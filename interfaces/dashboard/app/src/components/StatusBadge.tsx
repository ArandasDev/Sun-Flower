import type { ReactNode } from 'react';
import { Badge } from './ui/badge.tsx';

export type StatusTone = 'active' | 'inactive' | 'failed' | 'pending';

const VARIANT = {
  active: 'default',
  inactive: 'secondary',
  failed: 'destructive',
  pending: 'outline',
} as const;

/** Maps a state to a badge variant: active, stopped or discarded, failed, or in transition. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <Badge variant={VARIANT[tone]}>{children}</Badge>;
}
