/**
 * Match pagination controls
 */
type MatchPaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export function MatchPagination({
  currentPage,
  totalPages,
  onPageChange,
}: MatchPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="px-2 py-2 bg-scout-raised border-t border-scout-border flex justify-between items-center">
      <button
        onClick={() => {
          onPageChange(Math.max(1, currentPage - 1));
        }}
        disabled={currentPage === 1}
        className="px-3 py-1 text-xs bg-scout-surface text-scout-ink border border-scout-border rounded hover:bg-scout-raised disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Previous
      </button>
      <div className="flex items-center gap-2">
        <span className="text-xs text-scout-subtle">
          Page {currentPage} of {totalPages}
        </span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={currentPage}
          onChange={(e) => {
            const page = Number(e.target.value);
            if (page >= 1 && page <= totalPages) {
              onPageChange(page);
            }
          }}
          className="w-16 px-2 py-0.5 text-xs text-center bg-scout-surface text-scout-ink border border-scout-border rounded"
        />
      </div>
      <button
        onClick={() => {
          onPageChange(Math.min(totalPages, currentPage + 1));
        }}
        disabled={currentPage === totalPages}
        className="px-3 py-1 text-xs bg-scout-surface text-scout-ink border border-scout-border rounded hover:bg-scout-raised disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  );
}
