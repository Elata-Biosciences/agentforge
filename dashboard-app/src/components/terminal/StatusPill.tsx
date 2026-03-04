import { cn } from '@/lib/utils.ts';

type StatusVariant = 'pass' | 'fail' | 'warn' | 'info' | 'neutral' | 'live';

const variantClasses: Record<StatusVariant, string> = {
  pass: 'border-terminal-green/40 text-terminal-green bg-terminal-green/10',
  fail: 'border-terminal-red/40 text-terminal-red bg-terminal-red/10',
  warn: 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10',
  info: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
  neutral: 'border-border text-muted-foreground bg-muted/30',
  live: 'border-terminal-green/40 text-terminal-green bg-terminal-green/10',
};

export function StatusPill({
  children,
  variant = 'neutral',
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  variant?: StatusVariant;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] leading-tight',
        variantClasses[variant],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
