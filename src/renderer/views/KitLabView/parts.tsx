import { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

/** Status colors from the kit lab design (the app theme has no ok/warn tokens). */
export const OK_COLOR = '#3fae6a';

export const WARN_COLOR = '#d9a03a';

export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={twMerge(
        'm-0 font-ui text-[11px] leading-none font-semibold tracking-[0.12em] uppercase text-text-muted',
        className,
      )}
    >
      {children}
    </h3>
  );
}

export function Panel({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <section
      className={twMerge(
        'bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-3 min-w-0',
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={twMerge('m-0 text-xs text-text-muted', className)}>
      {children}
    </p>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-ui text-[11px] px-1 py-px rounded border border-border bg-surface-raised text-text-body">
      {children}
    </kbd>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="rounded-full shrink-0 shadow-[0_0_0_2px_rgba(0,0,0,0.4)]"
      style={{ background: color, width: size, height: size }}
    />
  );
}

/** Stage frame around a kit drawing. */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-[14px] border border-border overflow-hidden bg-[#121315] [&>svg]:block [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[72vh] [&>svg]:touch-none [&>svg]:select-none">
      {children}
    </div>
  );
}
