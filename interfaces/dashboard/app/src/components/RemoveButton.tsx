import { Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';

/**
 * The per-row "Remover" action: a `ghost` button in red. On hover the background takes a red
 * tint instead of `bg-accent` and the text a darker red (lighter in dark), so it keeps ≥4.5:1.
 */
export function RemoveButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'children'>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'text-destructive hover:bg-destructive/10 hover:text-red-700 dark:hover:bg-destructive/10 dark:hover:text-red-400',
        className,
      )}
      {...props}
    >
      <Trash2 aria-hidden="true" />
      Remover
    </Button>
  );
}
