import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-base font-bold mt-4 mb-2 text-foreground">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground/90">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-xs font-semibold mt-2 mb-1 text-foreground/80">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="text-xs text-foreground leading-relaxed mb-2">{children}</p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-cyan hover:underline"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-xs text-foreground">{children}</li>,
        code: ({ className, children }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <code className="block font-mono text-[11px] whitespace-pre-wrap break-words">
                {children}
              </code>
            );
          }
          return (
            <code className="font-mono text-[11px] bg-muted/60 px-1 py-0.5 rounded-sm text-terminal-amber">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-words border border-border/60 rounded-sm p-2.5 bg-card/80 mb-2 overflow-auto max-h-[400px]">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-terminal-cyan/40 pl-3 my-2 text-muted-foreground italic">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-auto mb-2">
            <table className="text-xs border-collapse w-full">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="border-b border-border/60 bg-muted/30">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-2 py-1 text-left text-[11px] font-semibold text-foreground/80">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-2 py-1 text-[11px] text-foreground border-t border-border/30">
            {children}
          </td>
        ),
        hr: () => <hr className="border-border/40 my-3" />,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
