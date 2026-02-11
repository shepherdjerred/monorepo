/**
 * Sound Entry Card Component
 *
 * Displays a single sound entry with controls for volume, preview, and removal.
 */

import { useState, useEffect } from "react";
import type { SoundEntry, SoundSource } from "@shepherdjerred/scout-data";
import { VolumeSlider } from "./volume-slider.tsx";
import type { CacheStatus } from "@shepherdjerred/scout-ui/types/adapter.ts";

type SoundEntryCardProps = {
  /** The sound entry to display */
  entry: SoundEntry;
  /** Called when the entry is updated */
  onUpdate: (updates: Partial<SoundEntry>) => void;
  /** Called when the entry should be removed */
  onRemove: () => void;
  /** Called when the sound should be previewed */
  onPreview: (source: SoundSource) => void;
  /** Called when preview should stop */
  onStopPreview: () => void;
  /** Called to cache a YouTube URL (optional) */
  onCache?: ((url: string) => Promise<void>) | undefined;
  /** Called to get cache status for a URL (optional) */
  getCacheStatus?: ((url: string) => Promise<CacheStatus>) | undefined;
};

// =============================================================================
// Helper functions to reduce component complexity
// =============================================================================

function getSourceIcon(sourceType: "file" | "url", isYouTube: boolean): { emoji: string; colorClass: string } {
  if (sourceType === "file") {
    return { emoji: "🎵", colorClass: "text-gray-500" };
  }
  if (isYouTube) {
    return { emoji: "▶", colorClass: "text-red-500" };
  }
  return { emoji: "🔗", colorClass: "text-blue-500" };
}

function getSourceTypeLabel(sourceType: "file" | "url", isYouTube: boolean): string {
  if (sourceType === "file") {
    return "File";
  }
  return isYouTube ? "YouTube" : "URL";
}

function getCacheButtonStyles(status: CacheStatus): { colorClass: string; title: string; emoji: string } {
  switch (status) {
    case "cached": {
      return { colorClass: "text-green-600", title: "Cached", emoji: "✓📥" };
    }
    case "caching": {
      return { colorClass: "text-yellow-600 animate-pulse", title: "Caching...", emoji: "⏳" };
    }
    case "error": {
      return { colorClass: "text-red-500", title: "Cache failed - click to retry", emoji: "📥" };
    }
    case "not-cached": {
      return { colorClass: "text-gray-500", title: "Cache audio", emoji: "📥" };
    }
  }
}

// =============================================================================
// CacheButton sub-component
// =============================================================================

type CacheButtonProps = {
  cacheStatus: CacheStatus;
  isCaching: boolean;
  onCache: () => void;
};

function CacheButton({ cacheStatus, isCaching, onCache }: CacheButtonProps) {
  const styles = getCacheButtonStyles(cacheStatus);

  return (
    <button
      type="button"
      onClick={onCache}
      disabled={isCaching || cacheStatus === "cached"}
      className={`p-2 rounded hover:bg-gray-100 text-xs ${styles.colorClass}`}
      title={styles.title}
    >
      {styles.emoji}
    </button>
  );
}

// =============================================================================
// Main component
// =============================================================================

export function SoundEntryCard({
  entry,
  onUpdate,
  onRemove,
  onPreview,
  onStopPreview,
  onCache,
  getCacheStatus,
}: SoundEntryCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>("not-cached");
  const [isCaching, setIsCaching] = useState(false);

  const isYouTube =
    entry.source.type === "url" && (entry.source.url.includes("youtube.com") || entry.source.url.includes("youtu.be"));

  // Check cache status on mount and when URL changes
  // eslint-disable-next-line custom-rules/no-use-effect -- Need to check cache status on mount
  useEffect(() => {
    const checkStatus = async () => {
      if (isYouTube && getCacheStatus && entry.source.type === "url") {
        const status = await getCacheStatus(entry.source.url);
        setCacheStatus(status);
      }
    };
    void checkStatus();
  }, [isYouTube, getCacheStatus, entry.source]);

  const handlePreview = () => {
    if (isPlaying) {
      onStopPreview();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      onPreview(entry.source);
      // Auto-stop after a reasonable time (sounds are usually short)
      setTimeout(() => {
        setIsPlaying(false);
      }, 10000);
    }
  };

  const handleCache = async () => {
    if (!onCache || entry.source.type !== "url" || isCaching) {
      return;
    }

    setIsCaching(true);
    setCacheStatus("caching");
    try {
      await onCache(entry.source.url);
      setCacheStatus("cached");
    } catch (error) {
      console.error("Failed to cache:", error);
      setCacheStatus("error");
    } finally {
      setIsCaching(false);
    }
  };

  const sourceDisplay =
    entry.source.type === "file" ? (entry.source.path.split("/").pop() ?? entry.source.path) : entry.source.url;

  const icon = getSourceIcon(entry.source.type, isYouTube);
  const typeLabel = getSourceTypeLabel(entry.source.type, isYouTube);

  return (
    <div className="border rounded-lg p-3 bg-white shadow-sm">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
          <span className={icon.colorClass}>{icon.emoji}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Source path/URL */}
          <div className="text-sm font-medium text-gray-900 truncate" title={sourceDisplay}>
            {sourceDisplay}
          </div>

          {/* Type badge */}
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              {typeLabel}
            </span>
            {!entry.enabled && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                Disabled
              </span>
            )}
          </div>

          {/* Volume slider */}
          <div className="mt-2">
            <VolumeSlider
              value={entry.volume}
              onChange={(volume) => {
                onUpdate({ volume });
              }}
              label="Volume"
            />
          </div>

          {/* Weight input (for weighted selection) */}
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor={`weight-${entry.id}`} className="text-xs text-gray-500">
              Weight:
            </label>
            <input
              id={`weight-${entry.id}`}
              type="number"
              min="0"
              step="0.1"
              value={entry.weight ?? 1}
              onChange={(e) => {
                onUpdate({ weight: Number(e.currentTarget.value) });
              }}
              className="w-16 px-2 py-1 text-xs border rounded"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              handlePreview();
            }}
            className={`p-2 rounded hover:bg-gray-100 ${isPlaying ? "text-blue-600" : "text-gray-500"}`}
            title={isPlaying ? "Stop preview" : "Preview sound"}
          >
            {isPlaying ? "⏹" : "▶️"}
          </button>
          {isYouTube && onCache && (
            <CacheButton
              cacheStatus={cacheStatus}
              isCaching={isCaching}
              onCache={() => {
                void handleCache();
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              onUpdate({ enabled: !entry.enabled });
            }}
            className={`p-2 rounded hover:bg-gray-100 ${entry.enabled ? "text-green-600" : "text-gray-400"}`}
            title={entry.enabled ? "Disable" : "Enable"}
          >
            {entry.enabled ? "✓" : "○"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-2 rounded hover:bg-red-50 text-red-500"
            title="Remove sound"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
