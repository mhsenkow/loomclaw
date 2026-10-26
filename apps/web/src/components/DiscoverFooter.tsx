// =================================================================
// DiscoverFooter — what is in the feed, and a way through it
// =================================================================

export function DiscoverFooter({
  shown, total, sources, sweeping, query, onQuery, onMethod,
}: {
  shown: number;
  total: number;
  sources: number;
  sweeping: boolean;
  query: string;
  onQuery: (q: string) => void;
  onMethod: () => void;
}) {
  return (
    <div className="discover-footer">
      <div className="discover-footer-meta">
        <span>
          {shown === total ? `${total} findings` : `${shown} of ${total} findings`}
        </span>
        <span aria-hidden>·</span>
        <span>{sources} sources</span>
        <span aria-hidden>·</span>
        <span className={sweeping ? "discover-updates-ready" : ""}>
          {sweeping ? "sweeping…" : "up to date"}
        </span>
        <button onClick={onMethod}>How findings are picked</button>
      </div>

      <div className="discover-search">
        <span className="discover-search-icon" aria-hidden>⌕</span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Find a finding, source, or test…"
          aria-label="Search findings"
        />
        {query && (
          <button className="discover-search-clear" onClick={() => onQuery("")} aria-label="Clear search">
            ×
          </button>
        )}
      </div>
    </div>
  );
}
