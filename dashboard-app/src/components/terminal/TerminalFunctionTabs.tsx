import { cn } from '@/lib/utils.ts';

export type FunctionTab = {
  id: string;
  label: string;
  number?: number;
  hidden?: boolean;
};

export function TerminalFunctionTabs({
  tabs,
  activeTab,
  onTabChange,
  className,
}: {
  tabs: FunctionTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky top-9 z-40 flex items-center gap-0 border-b border-border/50 bg-terminal-tabbar px-2 py-0 overflow-x-auto',
        className
      )}
    >
      {tabs
        .filter((t) => !t.hidden)
        .map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium tracking-wide uppercase whitespace-nowrap border-b-2 transition-colors cursor-pointer',
                isActive
                  ? 'border-terminal-tab-active text-terminal-tab-active bg-terminal-tab-active/10'
                  : 'border-transparent text-foreground/70 hover:text-foreground hover:bg-white/5'
              )}
            >
              {tab.number != null && (
                <span className="font-mono text-[10px] opacity-60">[{tab.number}]</span>
              )}
              {tab.label}
            </button>
          );
        })}
    </div>
  );
}
