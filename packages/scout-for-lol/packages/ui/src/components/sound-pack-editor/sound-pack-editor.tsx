/**
 * Sound Pack Editor Component
 *
 * Main editor component for creating and editing sound packs.
 */

import { useState, useCallback } from "react";
import { EVENT_TYPES, type SoundEntry } from "@scout-for-lol/data";
import { useSoundPackEditor } from "@scout-for-lol/ui/hooks/use-sound-pack-editor.tsx";
import { DefaultsTab } from "./defaults-tab.tsx";
import { RulesTab } from "./rules-tab.tsx";
import { SettingsTab } from "./settings-tab.tsx";

type Tab = "defaults" | "rules" | "settings";

type CacheAllState = {
  isRunning: boolean;
  total: number;
  completed: number;
  failed: number;
};

export function SoundPackEditor() {
  const [activeTab, setActiveTab] = useState<Tab>("defaults");
  const [cacheAllState, setCacheAllState] = useState<CacheAllState>({
    isRunning: false,
    total: 0,
    completed: 0,
    failed: 0,
  });
  const editor = useSoundPackEditor();

  // Collect all YouTube URLs from the sound pack
  const getYouTubeUrls = useCallback((): string[] => {
    const urls: string[] = [];
    const seen = new Set<string>();

    const addUrl = (entry: SoundEntry) => {
      if (
        entry.source.type === "url" &&
        (entry.source.url.includes("youtube.com") ||
          entry.source.url.includes("youtu.be")) &&
        !seen.has(entry.source.url)
      ) {
        seen.add(entry.source.url);
        urls.push(entry.source.url);
      }
    };

    // Check defaults
    for (const eventType of EVENT_TYPES) {
      const pool = editor.soundPack.defaults[eventType];
      if (pool) {
        for (const entry of pool.sounds) {
          addUrl(entry);
        }
      }
    }

    // Check rules
    for (const rule of editor.soundPack.rules) {
      for (const entry of rule.sounds.sounds) {
        addUrl(entry);
      }
    }

    return urls;
  }, [editor.soundPack]);

  // Cache all YouTube URLs
  const handleCacheAll = useCallback(async () => {
    const urls = getYouTubeUrls();
    if (urls.length === 0) {
      return;
    }

    setCacheAllState({
      isRunning: true,
      total: urls.length,
      completed: 0,
      failed: 0,
    });

    for (const url of urls) {
      try {
        // Check if already cached
        const status = await editor.adapter.getCacheStatus(url);
        if (status === "cached") {
          setCacheAllState((prev) => ({
            ...prev,
            completed: prev.completed + 1,
          }));
          continue;
        }

        // Cache the URL
        await editor.adapter.cacheYouTubeAudio(url);
        setCacheAllState((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
      } catch (error) {
        console.error("Failed to cache:", url, error);
        setCacheAllState((prev) => ({ ...prev, failed: prev.failed + 1 }));
      }
    }

    setCacheAllState((prev) => ({ ...prev, isRunning: false }));
  }, [getYouTubeUrls, editor.adapter]);

  const youtubeUrlCount = getYouTubeUrls().length;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Sound Pack Editor</h2>
          {editor.isDirty && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void editor.importPack();
            }}
            disabled={editor.isLoading}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => {
              void editor.exportPack();
            }}
            disabled={editor.isLoading}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Export
          </button>
          {youtubeUrlCount > 0 && (
            <button
              type="button"
              onClick={() => {
                void handleCacheAll();
              }}
              disabled={cacheAllState.isRunning}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
              title={`Cache all ${String(youtubeUrlCount)} YouTube audio files`}
            >
              {cacheAllState.isRunning ? (
                <>
                  <span className="animate-pulse">⏳</span>
                  {cacheAllState.completed + cacheAllState.failed}/
                  {cacheAllState.total}
                </>
              ) : (
                <>📥 Cache All ({youtubeUrlCount})</>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void editor.savePack();
            }}
            disabled={editor.isLoading || !editor.isDirty}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {editor.isLoading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Error display */}
      {editor.error !== null && editor.error.length > 0 && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span>{editor.error}</span>
          <button
            type="button"
            onClick={editor.clearError}
            className="text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {/* Pack name */}
      <div className="px-4 py-3 bg-white border-b">
        <label
          htmlFor="pack-name"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Pack Name
        </label>
        <input
          id="pack-name"
          type="text"
          value={editor.soundPack.name}
          onChange={(e) => {
            editor.updatePack({ name: e.currentTarget.value });
          }}
          className="w-full px-3 py-2 border rounded"
          placeholder="My Sound Pack"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white">
        {(["defaults", "rules", "settings"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "defaults" && "Default Sounds"}
            {tab === "rules" &&
              `Rules (${String(editor.soundPack.rules.length)})`}
            {tab === "settings" && "Settings"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "defaults" && <DefaultsTab />}
        {activeTab === "rules" && <RulesTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
