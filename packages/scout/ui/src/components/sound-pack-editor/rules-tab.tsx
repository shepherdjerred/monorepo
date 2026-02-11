import { useState } from "react";
import {
  RULE_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  createRuleFromTemplate,
  type RuleTemplate,
} from "@shepherdjerred/scout-data";
import { useSoundPackEditor } from "@shepherdjerred/scout-ui/hooks/use-sound-pack-editor.tsx";
import { RuleEditor } from "./rule-editor.tsx";

export function RulesTab() {
  const editor = useSoundPackEditor();
  const [showTemplates, setShowTemplates] = useState(false);

  const templatesByCategory = (["multikill", "objective", "player", "game"] as const).map((category) => ({
    category,
    label: TEMPLATE_CATEGORY_LABELS[category],
    templates: RULE_TEMPLATES.filter((t) => t.category === category),
  }));

  const addFromTemplate = (template: RuleTemplate) => {
    const rule = createRuleFromTemplate(template);
    editor.addRule(rule);
    setShowTemplates(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Rules are evaluated in priority order. The first matching rule&apos;s sounds will play.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowTemplates(!showTemplates);
            }}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
          >
            {showTemplates ? "Hide Templates" : "Add from Template"}
          </button>
          <button
            type="button"
            onClick={() => {
              editor.addRule();
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Add Rule
          </button>
        </div>
      </div>

      {/* Template picker */}
      {showTemplates && (
        <div className="border rounded-lg p-4 bg-white space-y-4">
          <h3 className="font-medium">Choose a template</h3>
          {templatesByCategory.map(({ category, label, templates }) => (
            <div key={category}>
              <h4 className="text-sm font-medium text-gray-700 mb-2">{label}</h4>
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <button
                    key={template.templateId}
                    type="button"
                    onClick={() => {
                      addFromTemplate(template);
                    }}
                    className="px-3 py-1.5 text-sm border rounded hover:bg-blue-50 hover:border-blue-300"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rules list */}
      {editor.soundPack.rules.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No rules configured.</p>
          <p className="text-sm mt-1">Add a rule to customize sounds based on game events.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {editor.soundPack.rules
            .sort((a, b) => b.priority - a.priority)
            .map((rule) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                onUpdate={(updates) => {
                  editor.updateRule(rule.id, updates);
                }}
                onRemove={() => {
                  editor.removeRule(rule.id);
                }}
                onAddSound={(entry) => {
                  editor.addRuleSound(rule.id, entry);
                }}
                onUpdateSound={(soundId, updates) => {
                  editor.updateRuleSound(rule.id, soundId, updates);
                }}
                onRemoveSound={(soundId) => {
                  editor.removeRuleSound(rule.id, soundId);
                }}
                onPreview={(source) => {
                  void editor.previewSound(source);
                }}
                onStopPreview={editor.stopPreview}
                onSelectFile={editor.adapter.selectAudioFile}
                champions={editor.champions}
                localPlayerName={editor.localPlayer?.summonerName}
                onCache={async (url) => {
                  await editor.adapter.cacheYouTubeAudio(url);
                }}
                getCacheStatus={editor.adapter.getCacheStatus}
              />
            ))}
        </div>
      )}
    </div>
  );
}
