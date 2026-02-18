/**
 * Personality selector component
 */
import type { Personality } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import { PersonalityEditor } from "./personality-editor.tsx";

type PersonalitySelectorProps = {
  personalities: Personality[];
  customPersonalities: Personality[];
  selectedPersonalityId: string;
  editingPersonality: Personality | null;
  showEditor: boolean;
  onSelect: (personality: Personality) => void;
  onSelectRandom: () => void;
  onCreateNew: () => void;
  onEdit: (personality: Personality, createCopy?: boolean) => void;
  onDelete: (id: string) => Promise<void>;
  onSave: (personality: Personality) => Promise<void>;
  onCancelEdit: () => void;
};

export function PersonalitySelector({
  personalities,
  customPersonalities,
  selectedPersonalityId,
  editingPersonality,
  showEditor,
  onSelect,
  onSelectRandom,
  onCreateNew,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
}: PersonalitySelectorProps) {
  if (showEditor) {
    return (
      <div>
        <PersonalityEditor
          personality={editingPersonality ?? undefined}
          onSave={(personality) => {
            void onSave(personality);
          }}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-surface-700">
          Personalities ({personalities.length})
        </label>
        <button
          onClick={onCreateNew}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
        >
          + Create New
        </button>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        <button
          onClick={onSelectRandom}
          className={`
            w-full p-3 rounded-lg border transition-colors text-left
            ${selectedPersonalityId === "random" ? "border-brand-500 bg-brand-50" : "border-surface-200 bg-white hover:border-surface-300"}
          `}
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-surface-900">Random</h4>
              <p className="text-xs text-surface-600">
                Pick a random personality for each review
              </p>
            </div>
            {selectedPersonalityId === "random" && (
              <span className="text-brand-600 text-xs flex items-center gap-1">
                <svg
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Active
              </span>
            )}
          </div>
        </button>

        {personalities.map((personality) => {
          const isCustom = customPersonalities.some(
            (p) => p.id === personality.id,
          );
          const isSelected = selectedPersonalityId === personality.id;
          return (
            <div
              key={personality.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect(personality);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(personality);
                }
              }}
              className={`
                p-3 rounded-lg border transition-colors cursor-pointer
                ${isSelected ? "border-brand-500 bg-brand-50" : "border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50"}
              `}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-surface-900">
                      {personality.metadata.name}
                    </h4>
                    {isCustom && (
                      <span className="px-1.5 py-0.5 bg-brand-100 text-brand-700 text-xs rounded">
                        Custom
                      </span>
                    )}
                    {isSelected && (
                      <span className="text-brand-600 flex items-center">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-600">
                    {personality.instructions.slice(0, 80)}
                    {personality.instructions.length > 80 ? "..." : ""}
                  </p>
                </div>
                <div
                  className="flex gap-1 ml-2"
                  role="presentation"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {isCustom ? (
                    <>
                      <button
                        onClick={() => {
                          onEdit(personality, false);
                        }}
                        className="px-2 py-1 bg-surface-100 text-surface-700 text-xs rounded hover:bg-surface-200 border border-surface-300"
                        title="Edit this personality"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onEdit(personality, true);
                        }}
                        className="px-2 py-1 bg-surface-100 text-surface-700 text-xs rounded hover:bg-surface-200 border border-surface-300"
                        title="Create a copy"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => {
                          void onDelete(personality.id);
                        }}
                        className="px-2 py-1 bg-defeat-100 text-defeat-700 text-xs rounded hover:bg-defeat-200 border border-defeat-300"
                        title="Delete this personality"
                      >
                        Del
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onEdit(personality, true);
                        }}
                        className="px-2 py-1 bg-surface-100 text-surface-700 text-xs rounded hover:bg-surface-200 border border-surface-300"
                        title="Edit a copy of this personality"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onEdit(personality, true);
                        }}
                        className="px-2 py-1 bg-surface-100 text-surface-700 text-xs rounded hover:bg-surface-200 border border-surface-300"
                        title="Create a copy"
                      >
                        Copy
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
