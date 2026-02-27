type InfoTipProps = {
  text: string;
  title?: string;
};

export function InfoTip({ text, title = 'More info' }: InfoTipProps) {
  return (
    <span title={`${title}: ${text}`} aria-label={title} className="infotip">
      i
    </span>
  );
}
