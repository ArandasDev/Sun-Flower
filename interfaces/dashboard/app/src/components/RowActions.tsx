import { EllipsisIcon, Trash2 } from 'lucide-react';
import { Button } from './ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';

export interface RowAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface RowActionsProps {
  label: string;
  items: RowAction[];
}

/**
 * Red text on the highlighted item's `bg-accent` falls below 4.5:1 (3.9:1 in dark), so a
 * destructive item turns to the regular text color while highlighted and keeps its red icon.
 */
const DESTRUCTIVE_ITEM =
  'text-destructive focus:text-accent-foreground data-[highlighted]:text-accent-foreground';

/** A per-row actions menu; the trigger is named so each row's menu is reachable by name. */
export function RowActions({ label, items }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={item.disabled}
            className={item.destructive ? DESTRUCTIVE_ITEM : undefined}
            onSelect={item.onSelect}
          >
            {item.destructive ? <Trash2 aria-hidden="true" className="text-destructive" /> : null}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
