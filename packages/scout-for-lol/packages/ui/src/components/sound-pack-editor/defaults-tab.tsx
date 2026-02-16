import { useState } from "react";
import {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  createEmptySoundPool,
  type EventType,
} from "@scout-for-lol/data";
import { useSoundPackEditor } from "@scout-for-lol/ui/hooks/use-sound-pack-editor.tsx";
import { SoundPoolEditor } from "./sound-pool-editor.tsx";

export function DefaultsTab() {
  const editor = useSoundPackEditor();
  const [expandedEvent, setExpandedEvent] = useState<EventType | null>("kill");

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 mb-4">
        Default sounds play when no rules match. Configure sounds for each event
        type.
      </p>

      {EVENT_TYPES.map((eventType) => {
        const pool =
          editor.soundPack.defaults[eventType] ?? createEmptySoundPool();
        const info = EVENT_TYPE_LABELS[eventType];
        const isExpanded = expandedEvent === eventType;

        return (
          <div
            key={eventType}
            className="border rounded-lg bg-white overflow-hidden"
          >
            {/* Header */}
            <button
              type="button"
              onClick={() => {
                setExpandedEvent(isExpanded ? null : eventType);
              }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-400">{isExpanded ? "▼" : "▶"}</span>
                <div className="text-left">
                  <div className="font-medium">{info.label}</div>
                  <div className="text-xs text-gray-500">
                    {info.description}
                  </div>
                </div>
              </div>
              <span className="text-sm text-gray-500">
                {pool.sounds.length} sound{pool.sounds.length !== 1 ? "s" : ""}
              </span>
            </button>

            {/* Content */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t">
                <SoundPoolEditor
                  pool={pool}
                  onUpdate={(updatedPool) => {
                    editor.setDefaultPool(eventType, updatedPool);
                  }}
                  onAddSound={(entry) => {
                    editor.addDefaultSound(eventType, entry);
                  }}
                  onUpdateSound={(soundId, updates) => {
                    editor.updateDefaultSound(eventType, soundId, updates);
                  }}
                  onRemoveSound={(soundId) => {
                    editor.removeDefaultSound(eventType, soundId);
                  }}
                  onPreview={(source) => {
                    void editor.previewSound(source);
                  }}
                  onStopPreview={editor.stopPreview}
                  onSelectFile={editor.adapter.selectAudioFile}
                  onCache={async (url) => {
                    await editor.adapter.cacheYouTubeAudio(url);
                  }}
                  getCacheStatus={editor.adapter.getCacheStatus}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
