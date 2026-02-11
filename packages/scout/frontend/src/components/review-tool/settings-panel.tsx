/**
 * Settings panel for tuning parameters
 */
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import type { TabConfig, Personality } from "@shepherdjerred/scout-frontend/lib/review-tool/config/schema";
import {
  createDefaultTabConfig,
  createDefaultPipelineStages,
} from "@shepherdjerred/scout-frontend/lib/review-tool/config/schema";
import { BUILTIN_PERSONALITIES } from "@shepherdjerred/scout-frontend/lib/review-tool/prompts";
import { ConfigImportModal } from "./config-import-modal.tsx";
import { downloadConfigBundle } from "@shepherdjerred/scout-frontend/lib/review-tool/config-export";
import { PromptSettings } from "./prompt-settings.tsx";
import { ConfigActions } from "./config-actions.tsx";

const ErrorSchema = z.object({ message: z.string() });
import {
  loadCustomPersonalities,
  addCustomPersonality,
  updateCustomPersonality,
  deleteCustomPersonality,
  generatePersonalityId,
} from "@shepherdjerred/scout-frontend/lib/review-tool/personality-storage";
import { StageConfigSections } from "./stage-config/stage-config-sections.tsx";

type SettingsPanelProps = {
  config: TabConfig;
  onChange: (config: TabConfig) => void;
};

// Store for custom data
type CustomDataState = {
  personalities: Personality[];
};

let customDataState: CustomDataState = {
  personalities: [],
};

const customDataListeners = new Set<() => void>();

function subscribeToCustomData(callback: () => void) {
  customDataListeners.add(callback);
  return () => {
    customDataListeners.delete(callback);
  };
}

function getCustomDataSnapshot() {
  return customDataState;
}

// Load custom data at module level
let customDataLoadPromise: Promise<void> | null = null;

function loadCustomData() {
  customDataLoadPromise ??= (async () => {
    customDataState = {
      personalities: await loadCustomPersonalities(),
    };
    customDataListeners.forEach((listener) => {
      listener();
    });
  })();
  return customDataLoadPromise;
}

// Start loading immediately
void loadCustomData();

function getStagesOrDefault(config: TabConfig) {
  return config.stages ?? createDefaultPipelineStages();
}

export function SettingsPanel({ config, onChange }: SettingsPanelProps) {
  // Subscribe to custom data store
  const customData = useSyncExternalStore(subscribeToCustomData, getCustomDataSnapshot, getCustomDataSnapshot);
  const { personalities: customPersonalities } = customData;

  const [editingPersonality, setEditingPersonality] = useState<Personality | null>(null);
  const [showPersonalityEditor, setShowPersonalityEditor] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);

  const allPersonalities = [...BUILTIN_PERSONALITIES.filter((p) => p.id !== "generic"), ...customPersonalities];

  const handleCreateNewPersonality = () => {
    setEditingPersonality(null);
    setShowPersonalityEditor(true);
  };

  const handleEditPersonality = (personality: Personality, createCopy = false) => {
    if (createCopy) {
      // Create a copy of built-in personality with a new ID
      const copy: Personality = {
        ...personality,
        id: generatePersonalityId(`${personality.metadata.name} (Copy)`),
        metadata: {
          ...personality.metadata,
          name: `${personality.metadata.name} (Copy)`,
        },
      };
      setEditingPersonality(copy);
    } else {
      setEditingPersonality(personality);
    }
    setShowPersonalityEditor(true);
  };

  const refreshCustomData = async () => {
    customDataState = {
      personalities: await loadCustomPersonalities(),
    };
    customDataListeners.forEach((listener) => {
      listener();
    });
  };

  const handleSavePersonality = async (personality: Personality) => {
    const existsInCustom = customPersonalities.some((p) => p.id === personality.id);

    if (editingPersonality && existsInCustom) {
      // Update existing custom personality
      await updateCustomPersonality(personality);
    } else {
      // Create new custom personality (or copy of built-in)
      const newPersonality = {
        ...personality,
        id: editingPersonality?.id ?? generatePersonalityId(personality.metadata.name),
      };
      await addCustomPersonality(newPersonality);
    }

    await refreshCustomData();
    setShowPersonalityEditor(false);
    setEditingPersonality(null);
  };

  const handleDeletePersonality = async (id: string) => {
    if (confirm("Are you sure you want to delete this personality?")) {
      await deleteCustomPersonality(id);
      await refreshCustomData();
      if (config.prompts.personalityId === id) {
        onChange({
          ...config,
          prompts: { ...config.prompts, personalityId: "random", customPersonality: undefined },
        });
      }
    }
  };

  const handleExportConfig = () => {
    void (async () => {
      try {
        await downloadConfigBundle(config);
      } catch (error) {
        const errorResult = ErrorSchema.safeParse(error);
        alert(`Failed to export config: ${errorResult.success ? errorResult.data.message : String(error)}`);
      }
    })();
  };

  const handleImportConfig = () => {
    setShowImportModal(true);
  };

  const handleImportSuccess = async (newConfig?: TabConfig) => {
    if (newConfig) {
      onChange(newConfig);
    }
    // Reload personalities/styles/themes from storage
    await refreshCustomData();
  };

  const handleResetToDefaults = () => {
    if (confirm("Reset settings to defaults? This will not affect custom personalities or art styles.")) {
      onChange(createDefaultTabConfig());
    }
  };

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-surface-200/50">
        <h2 className="text-lg font-semibold text-surface-900">Generation Settings</h2>
        <p className="text-sm text-surface-500 mt-0.5">Configure how reviews are generated</p>
      </div>

      <div className="divide-y divide-surface-200/50">
        <div className="px-4 py-5 bg-surface-50">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-surface-900">Pipeline stages</h3>
            <p className="text-sm text-surface-500">
              Configure the unified review pipeline stages used by frontend and backend.
            </p>
          </div>
          <StageConfigSections
            stages={getStagesOrDefault(config)}
            onChange={(next) => {
              onChange({ ...config, stages: next });
            }}
          />
        </div>

        <PromptSettings
          config={config}
          personalities={allPersonalities}
          customPersonalities={customPersonalities}
          editingPersonality={editingPersonality}
          showPersonalityEditor={showPersonalityEditor}
          onChange={onChange}
          onCreateNewPersonality={handleCreateNewPersonality}
          onEditPersonality={handleEditPersonality}
          onDeletePersonality={handleDeletePersonality}
          onSavePersonality={handleSavePersonality}
          onCancelPersonalityEdit={() => {
            setShowPersonalityEditor(false);
            setEditingPersonality(null);
          }}
        />
      </div>

      <ConfigActions onExport={handleExportConfig} onImport={handleImportConfig} onReset={handleResetToDefaults} />

      {/* Import Modal */}
      <ConfigImportModal
        isOpen={showImportModal}
        onClose={() => {
          setShowImportModal(false);
        }}
        onImportSuccess={(newConfig) => {
          void handleImportSuccess(newConfig);
        }}
      />
    </div>
  );
}
