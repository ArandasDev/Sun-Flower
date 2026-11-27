import type { ReactNode, Ref } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
  /** For a screen that moves focus to its title (after a confirmation); the title then takes focus. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** The title block every screen starts with; the actions sit to the right, below the text on a phone. */
export function PageHeader({ title, description, actions, headingRef }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          ref={headingRef}
          {...(headingRef === undefined ? {} : { tabIndex: -1 })}
          className="text-2xl font-semibold tracking-tight"
        >
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
