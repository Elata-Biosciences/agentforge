import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function isJsonLike(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'object') return true;
  if (typeof v !== 'string') return false;
  const t = (v as string).trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function JsonPopover({ value, children }: { value: unknown; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelH = 400;
    const panelW = 480;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > panelH + 8 ? rect.bottom + 4 : rect.top - panelH - 4;
    const left = Math.min(rect.left, window.innerWidth - panelW - 8);
    setPos({ top: Math.max(4, top), left: Math.max(4, left) });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function onDown(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { setOpen(false); return; }
      if (e instanceof MouseEvent) {
        if (panelRef.current?.contains(e.target as Node)) return;
        if (triggerRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onDown);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onDown);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  if (!isJsonLike(value)) return <>{children}</>;

  const formatted = formatValue(value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="text-left truncate max-w-full cursor-pointer bg-transparent border-none p-0 font-mono text-[11px] text-inherit hover:text-terminal-tab-active transition-colors"
      >
        {children}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] min-w-[300px] max-w-[600px] max-h-[400px] overflow-auto rounded-sm border border-border bg-card shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60 sticky top-0 bg-card">
            <span className="text-[10px] text-muted-foreground font-mono">JSON Inspector</span>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(formatted); }}
              className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer bg-muted/50 border border-border/60 rounded-sm px-1.5 py-0.5"
            >
              Copy
            </button>
          </div>
          <pre className="p-2 text-[11px] font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed m-0">
            {formatted}
          </pre>
        </div>,
        document.body,
      )}
    </>
  );
}
