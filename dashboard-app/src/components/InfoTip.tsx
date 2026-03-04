type InfoTipProps = {
  text: string;
  title?: string;
};

export function InfoTip({ text, title = 'More info' }: InfoTipProps) {
  return (
    <span
      title={`${title}: ${text}`}
      aria-label={title}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border border-border/60 text-muted-foreground text-[10px] bg-muted/40 cursor-help select-none"
    >
      i
    </span>
  );
}
