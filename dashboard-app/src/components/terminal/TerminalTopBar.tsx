import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export function TerminalTopBar({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 flex h-9 items-center justify-between gap-3 border-b border-border/50 bg-terminal-topbar px-3 text-xs font-medium text-foreground',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0">{left}</div>
      <div className="flex items-center gap-2 font-mono text-xs truncate">{center}</div>
      <div className="flex items-center gap-2 min-w-0 justify-end">{right}</div>
    </div>
  );
}
