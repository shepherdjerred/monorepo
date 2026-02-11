/**
 * Prompt settings section (base prompt and personality selector)
 */
import { getBasePrompt } from "@shepherdjerred/scout-frontend/lib/review-tool/prompts";
import type { TabConfig, Personality } from "@shepherdjerred/scout-frontend/lib/review-tool/config/schema";
import { PersonalitySelector } from "./personality-selector.tsx";

type PromptSettingsProps = {
  config: TabConfig;
  personalities: Personality[];
  customPersonalities: Personality[];
  editingPersonality: Personality | null;
  showPersonalityEditor: boolean;
  onChange: (config: TabConfig) => void;
  onCreateNewPersonality: () => void;
  onEditPersonality: (personality: Personality, createCopy?: boolean) => void;
  onDeletePersonality: (id: string) => Promise<void>;
  onSavePersonality: (personality: Personality) => Promise<void>;
  onCancelPersonalityEdit: () => void;
};

export function PromptSettings({
  config,
  personalities,
  customPersonalities,
  editingPersonality,
  showPersonalityEditor,
  onChange,
  onCreateNewPersonality,
  onEditPersonality,
  onDeletePersonality,
  onSavePersonality,
  onCancelPersonalityEdit,
}: PromptSettingsProps) {
  const handleSelectPersonality = (personality: Personality) => {
    onChange({
      ...config,
      prompts: {
        ...config.prompts,
        customPersonality: personality,
        personalityId: personality.id,
      },
    });
  };

  const handleSelectRandom = () => {
    onChange({
      ...config,
      prompts: { ...config.prompts, personalityId: "random", customPersonality: undefined },
    });
  };

  return (
    <div>
      <div className="w-full px-4 py-3 flex justify-between items-center bg-surface-50">
        <span className="font-semibold text-surface-900 text-sm">Prompts & Personality</span>
      </div>
      <div>
        <div className="px-4 pb-4 space-y-3">
          <div>
            <label htmlFor="base-prompt" className="block text-sm font-medium text-surface-700 mb-1">
              Base Prompt
            </label>
            <textarea
              id="base-prompt"
              value={config.prompts.basePrompt || getBasePrompt()}
              onChange={(e) => {
                onChange({
                  ...config,
                  prompts: { ...config.prompts, basePrompt: e.target.value },
                });
              }}
              rows={12}
              className="w-full px-3 py-2 text-xs bg-white text-surface-900 border border-surface-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 font-mono placeholder:text-surface-400"
              placeholder="Base prompt template..."
            />
            <button
              onClick={() => {
                onChange({
                  ...config,
                  prompts: { ...config.prompts, basePrompt: getBasePrompt() },
                });
              }}
              className="mt-2 text-sm text-brand-600 hover:text-blue-700"
            >
              Reset to Default
            </button>
          </div>

          <PersonalitySelector
            personalities={personalities}
            customPersonalities={customPersonalities}
            selectedPersonalityId={config.prompts.personalityId}
            editingPersonality={editingPersonality}
            showEditor={showPersonalityEditor}
            onSelect={handleSelectPersonality}
            onSelectRandom={handleSelectRandom}
            onCreateNew={onCreateNewPersonality}
            onEdit={onEditPersonality}
            onDelete={onDeletePersonality}
            onSave={onSavePersonality}
            onCancelEdit={onCancelPersonalityEdit}
          />
        </div>
      </div>
    </div>
  );
}
