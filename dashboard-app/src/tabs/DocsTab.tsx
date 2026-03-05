import { useCallback, useEffect, useState } from 'react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer.tsx';
import { TerminalPanel } from '@/components/terminal/index.ts';

interface DocEntry {
  title: string;
  path: string;
}

export function DocsTab({ studioHost }: { studioHost: string }) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studioHost) return;
    (async () => {
      try {
        const resp = await fetch(`${studioHost}/api/docs`);
        const data = (await resp.json()) as { ok?: boolean; docs?: DocEntry[] };
        if (data.ok && Array.isArray(data.docs)) {
          setDocs(data.docs);
          if (data.docs.length > 0 && !selectedPath) {
            setSelectedPath(data.docs[0].path);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [studioHost]);

  const loadDoc = useCallback(
    async (docPath: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${studioHost}/api/docs/${encodeURIComponent(docPath)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        setContent(await resp.text());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setContent('');
      } finally {
        setLoading(false);
      }
    },
    [studioHost],
  );

  useEffect(() => {
    if (selectedPath) void loadDoc(selectedPath);
  }, [selectedPath, loadDoc]);

  return (
    <div className="flex gap-3 h-full min-h-[400px]">
      <div className="w-56 shrink-0">
        <TerminalPanel title="Documentation">
          <nav className="space-y-0.5">
            {docs.map((doc) => (
              <button
                key={doc.path}
                onClick={() => setSelectedPath(doc.path)}
                className={`w-full text-left px-2 py-1.5 text-xs rounded-sm transition-colors ${
                  selectedPath === doc.path
                    ? 'bg-terminal-tab-active/20 text-terminal-tab-active font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                {doc.title}
              </button>
            ))}
            {docs.length === 0 && !error && (
              <div className="text-xs text-muted-foreground px-2">Loading...</div>
            )}
          </nav>
        </TerminalPanel>
      </div>

      <div className="flex-1 min-w-0">
        <TerminalPanel
          title={docs.find((d) => d.path === selectedPath)?.title ?? 'Document'}
          subtitle={selectedPath ?? undefined}
        >
          {error && (
            <div className="text-xs text-terminal-red font-mono mb-2">{error}</div>
          )}
          {loading ? (
            <div className="text-xs text-muted-foreground">Loading...</div>
          ) : content ? (
            <div className="max-h-[calc(100vh-200px)] overflow-auto pr-2">
              <MarkdownRenderer content={content} basePath={selectedPath ?? undefined} assetHost={studioHost} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Select a document from the sidebar.
            </div>
          )}
        </TerminalPanel>
      </div>
    </div>
  );
}
