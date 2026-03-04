import { cn } from '@/lib/utils.ts';

export function KeyHint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[10px] text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}
