/**
 * Match loading progress indicator
 */
type MatchLoadingStateProps = {
  loading: boolean;
  loadingProgress: { current: number; total: number } | null;
  onCancel: () => void;
};

export function MatchLoadingState({
  loading,
  loadingProgress,
  onCancel,
}: MatchLoadingStateProps) {
  if (!loading) {
    return null;
  }

  return (
    <div className="text-center py-2 text-sm text-surface-600">
      {loadingProgress ? (
        <div className="space-y-2">
          <div>
            Loading matches... {loadingProgress.current}/{loadingProgress.total}
          </div>
          <div className="w-full bg-surface-200 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${((loadingProgress.current / loadingProgress.total) * 100).toString()}%`,
              }}
            />
          </div>
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>Loading matches...</div>
      )}
    </div>
  );
}
