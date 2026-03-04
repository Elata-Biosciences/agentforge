import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export function TerminalLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-h-screen bg-background text-foreground', className)}>
      {children}
    </div>
  );
}
