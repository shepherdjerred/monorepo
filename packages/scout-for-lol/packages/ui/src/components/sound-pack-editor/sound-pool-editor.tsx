/**
 * Sound Pool Editor Component
 *
 * Manages a pool of sounds with selection mode and add/remove functionality.
 */

import { useState } from "react";
import type {
  SoundPool,
  SoundEntry,
  SelectionMode,
  SoundSource,
} from "@scout-for-lol/data";
import { SoundEntryCard } from "./sound-entry-card.tsx";
import type { CacheStatus } from "@scout-for-lol/ui/types/adapter.ts";

type SoundPoolEditorProps = {
  /** The sound pool to edit */
  pool: SoundPool;
  /** Called when the pool is updated */
  onUpdate: (pool: SoundPool) => void;
  /** Called when a sound is added */
  onAddSound: (entry: Omit<SoundEntry, "id">) => void;
  /** Called when a sound is updated */
  onUpdateSound: (soundId: string, updates: Partial<SoundEntry>) => void;
  /** Called when a sound is removed */
  onRemoveSound: (soundId: string) => void;
  /** Called when a sound should be previewed */
  onPreview: (source: SoundSource) => void;
  /** Called when preview should stop */
  onStopPreview: () => void;
  /** Function to select an audio file */
  onSelectFile: () => Promise<string | null>;
  /** Title for the section (optional) */
  title?: string;
  /** Called to cache a YouTube URL (optional) */
  onCache?: ((url: string) => Promise<void>) | undefined;
  /** Called to get cache status for a URL (optional) */
  getCacheStatus?: ((url: string) => Promise<CacheStatus>) | undefined;
};

const SELECTION_MODE_LABELS: Record<SelectionMode, string> = {
  random: "Random",
  sequential: "Sequential",
  weighted: "Weighted",
};

export function SoundPoolEditor({
  pool,
  onUpdate,
  onAddSound,
  onUpdateSound,
  onRemoveSound,
  onPreview,
  onStopPreview,
  onSelectFile,
  title,
  onCache,
  getCacheStatus,
}: SoundPoolEditorProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSoundUrl, setNewSoundUrl] = useState("");

  const handleAddUrl = () => {
    if (newSoundUrl.trim()) {
      onAddSound({
        source: { type: "url", url: newSoundUrl.trim() },
        volume: 1,
        enabled: true,
      });
      setNewSoundUrl("");
      setShowAddForm(false);
    }
  };

  const handleAddFile = async () => {
    const path = await onSelectFile();
    if (path) {
      onAddSound({
        source: { type: "file", path },
        volume: 1,
        enabled: true,
      });
      setShowAddForm(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        {title && (
          <h4 className="text-sm font-medium text-gray-700">{title}</h4>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="selection-mode" className="text-xs text-gray-500">
            Selection:
          </label>
          <select
            id="selection-mode"
            value={pool.selectionMode}
            onChange={(e) => {
              const value = e.currentTarget.value;
              // Type guard for selection mode
              if (
                value === "random" ||
                value === "sequential" ||
                value === "weighted"
              ) {
                onUpdate({ ...pool, selectionMode: value });
              }
            }}
            className="text-xs px-2 py-1 border rounded bg-white"
          >
            {(["random", "sequential", "weighted"] as const).map((mode) => (
              <option key={mode} value={mode}>
                {SELECTION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sound entries */}
      {pool.sounds.length === 0 ? (
        <div className="text-sm text-gray-500 italic py-2">
          No sounds configured
        </div>
      ) : (
        <div className="space-y-2">
          {pool.sounds.map((entry) => (
            <SoundEntryCard
              key={entry.id}
              entry={entry}
              onUpdate={(updates) => {
                onUpdateSound(entry.id, updates);
              }}
              onRemove={() => {
                onRemoveSound(entry.id);
              }}
              onPreview={onPreview}
              onStopPreview={onStopPreview}
              onCache={onCache}
              getCacheStatus={getCacheStatus}
            />
          ))}
        </div>
      )}

      {/* Add sound form */}
      {showAddForm ? (
        <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
          <div className="text-sm font-medium text-gray-700">Add Sound</div>

          {/* URL input */}
          <div className="space-y-2">
            <label htmlFor="new-sound-url" className="text-xs text-gray-500">
              YouTube or Audio URL
            </label>
            <div className="flex gap-2">
              <input
                id="new-sound-url"
                type="url"
                value={newSoundUrl}
                onChange={(e) => {
                  setNewSoundUrl(e.currentTarget.value);
                }}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 px-3 py-2 border rounded text-sm"
              />
              <button
                type="button"
                onClick={handleAddUrl}
                disabled={!newSoundUrl.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add URL
              </button>
            </div>
          </div>

          {/* File picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">or</span>
            <button
              type="button"
              onClick={() => {
                void handleAddFile();
              }}
              className="px-3 py-2 border border-gray-300 rounded text-sm hover:bg-gray-100"
            >
              Select File...
            </button>
          </div>

          {/* Cancel button */}
          <button
            type="button"
            onClick={() => {
              setShowAddForm(false);
              setNewSoundUrl("");
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowAddForm(true);
          }}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600"
        >
          + Add Sound
        </button>
      )}
    </div>
  );
}
