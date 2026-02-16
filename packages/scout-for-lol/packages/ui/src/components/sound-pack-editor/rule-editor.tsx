/**
 * Rule Editor Component
 *
 * Edits a single sound rule including conditions and sounds.
 */

import { useState } from "react";
import type { SoundRule, SoundEntry, SoundSource } from "@scout-for-lol/data";
import type { Champion, CacheStatus } from "@scout-for-lol/ui/types/adapter.ts";
import { ConditionBuilder } from "./condition-builder.tsx";
import { SoundPoolEditor } from "./sound-pool-editor.tsx";

type RuleEditorProps = {
  /** The rule to edit */
  rule: SoundRule;
  /** Called when the rule is updated */
  onUpdate: (updates: Partial<SoundRule>) => void;
  /** Called when the rule should be removed */
  onRemove: () => void;
  /** Called when a sound should be added to the rule */
  onAddSound: (entry: Omit<SoundEntry, "id">) => void;
  /** Called when a sound in the rule should be updated */
  onUpdateSound: (soundId: string, updates: Partial<SoundEntry>) => void;
  /** Called when a sound should be removed from the rule */
  onRemoveSound: (soundId: string) => void;
  /** Called when a sound should be previewed */
  onPreview: (source: SoundSource) => void;
  /** Called when preview should stop */
  onStopPreview: () => void;
  /** Function to select an audio file */
  onSelectFile: () => Promise<string | null>;
  /** Available champions for autocomplete */
  champions: Champion[];
  /** Local player name (if available) */
  localPlayerName?: string | undefined;
  /** Called to cache a YouTube URL (optional) */
  onCache?: ((url: string) => Promise<void>) | undefined;
  /** Called to get cache status for a URL (optional) */
  getCacheStatus?: ((url: string) => Promise<CacheStatus>) | undefined;
};

export function RuleEditor({
  rule,
  onUpdate,
  onRemove,
  onAddSound,
  onUpdateSound,
  onRemoveSound,
  onPreview,
  onStopPreview,
  onSelectFile,
  champions,
  localPlayerName,
  onCache,
  getCacheStatus,
}: RuleEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
          !rule.enabled ? "bg-gray-100" : ""
        }`}
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* Expand/collapse icon */}
        <span className="text-gray-400">{isExpanded ? "▼" : "▶"}</span>

        {/* Enabled toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ enabled: !rule.enabled });
          }}
          className={`w-5 h-5 rounded border flex items-center justify-center ${
            rule.enabled ? "bg-green-500 border-green-500 text-white" : "bg-white border-gray-300"
          }`}
          title={rule.enabled ? "Disable rule" : "Enable rule"}
        >
          {rule.enabled && "✓"}
        </button>

        {/* Rule name (editable) */}
        <input
          type="text"
          value={rule.name}
          onChange={(e) => {
            onUpdate({ name: e.currentTarget.value });
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="flex-1 font-medium bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
          placeholder="Rule name"
        />

        {/* Priority */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Priority input area needs to stop click propagation */}
        <div
          className="flex items-center gap-1"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <label htmlFor={`priority-${rule.id}`} className="text-xs text-gray-500">
            Priority:
          </label>
          <input
            id={`priority-${rule.id}`}
            type="number"
            min="0"
            max="1000"
            value={rule.priority}
            onChange={(e) => {
              onUpdate({ priority: Number(e.currentTarget.value) });
            }}
            className="w-16 px-2 py-1 text-xs border rounded"
          />
        </div>

        {/* Delete button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-red-500 hover:bg-red-50 rounded"
          title="Delete rule"
        >
          🗑
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 py-3 border-t space-y-4">
          {/* Condition logic selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Match</span>
            <select
              value={rule.conditionLogic}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value === "all" || value === "any") {
                  onUpdate({ conditionLogic: value });
                }
              }}
              className="px-2 py-1 border rounded text-sm bg-white"
            >
              <option value="all">All conditions (AND)</option>
              <option value="any">Any condition (OR)</option>
            </select>
          </div>

          {/* Conditions */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Conditions</h4>
            <ConditionBuilder
              conditions={rule.conditions}
              onChange={(conditions) => {
                onUpdate({ conditions });
              }}
              champions={champions}
              localPlayerName={localPlayerName}
            />
          </div>

          {/* Sounds */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Sounds</h4>
            <SoundPoolEditor
              pool={rule.sounds}
              onUpdate={(sounds) => {
                onUpdate({ sounds });
              }}
              onAddSound={onAddSound}
              onUpdateSound={onUpdateSound}
              onRemoveSound={onRemoveSound}
              onPreview={onPreview}
              onStopPreview={onStopPreview}
              onSelectFile={onSelectFile}
              onCache={onCache}
              getCacheStatus={getCacheStatus}
            />
          </div>
        </div>
      )}
    </div>
  );
}
