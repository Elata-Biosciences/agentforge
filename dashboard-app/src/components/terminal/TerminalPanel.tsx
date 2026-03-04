import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export function TerminalPanel({
  title,
  subtitle,
  actions,
  children,
  variant = 'default',
  className,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'dense' | 'flush';
  className?: string;
}) {
  const padding = variant === 'flush' ? 'p-0' : variant === 'dense' ? 'p-2' : 'p-3';
  return (
    <div
      className={cn(
        'border border-border/60 bg-card rounded-sm',
        padding,
        className
      )}
    >
      {(title || actions) && (
        <div className={cn(
          'flex items-baseline justify-between gap-2 mb-2',
          variant === 'flush' && 'px-3 pt-3'
        )}>
          <div>
            {title && (
              <h3 className="text-sm font-semibold tracking-wide text-foreground">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
