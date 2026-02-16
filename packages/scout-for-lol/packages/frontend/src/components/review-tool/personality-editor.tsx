/**
 * Personality editor modal for creating/editing personalities
 */
import { useState } from "react";
import { z } from "zod";
import type { Personality, PersonalityMetadata } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import { PersonalitySchema } from "@scout-for-lol/frontend/lib/review-tool/config/schema";

const ErrorSchema = z.object({ message: z.string() });

type PersonalityEditorProps = {
  personality?: Personality | undefined;
  onSave: (personality: Personality) => void;
  onCancel: () => void;
};

export function PersonalityEditor({ personality, onSave, onCancel }: PersonalityEditorProps) {
  const [name, setName] = useState(personality?.metadata.name ?? "");
  const [instructions, setInstructions] = useState(personality?.instructions ?? "");
  const [styleCard, setStyleCard] = useState(personality?.styleCard ?? "");
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    try {
      const metadata: PersonalityMetadata = {
        name: name.trim(),
      };

      const newPersonality: Personality = {
        id: personality?.id ?? `custom-${Date.now().toString()}`,
        metadata,
        instructions: instructions.trim(),
        styleCard: styleCard.trim(),
      };

      // Validate with Zod
      PersonalitySchema.parse(newPersonality);

      onSave(newPersonality);
    } catch (err) {
      const errorResult = ErrorSchema.safeParse(err);
      setError(errorResult.success ? errorResult.data.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-surface-200 sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-surface-900">
            {personality ? "Edit Personality" : "Create New Personality"}
          </h2>
        </div>

        <div className="p-6 space-y-6">
          {error && <div className="p-4 bg-red-50 border border-red-200 rounded text-red-800">{error}</div>}

          <div>
            <label htmlFor="personality-name" className="block text-sm font-medium text-surface-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="personality-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="e.g., Friendly Coach"
            />
          </div>

          <div>
            <label htmlFor="personality-instructions" className="block text-sm font-medium text-surface-700 mb-1">
              Instructions / System Prompt <span className="text-red-500">*</span>
            </label>
            <textarea
              id="personality-instructions"
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
              }}
              rows={15}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 font-mono text-sm placeholder:text-surface-400"
              placeholder="Detailed instructions for how this reviewer should behave and write reviews..."
            />
            <p className="mt-1 text-sm text-surface-500">
              This is the system prompt that defines how the reviewer thinks and writes.
            </p>
          </div>

          <div>
            <label htmlFor="personality-style-card" className="block text-sm font-medium text-surface-700 mb-1">
              Style Card (required)
            </label>
            <textarea
              id="personality-style-card"
              value={styleCard}
              onChange={(e) => {
                setStyleCard(e.target.value);
              }}
              rows={12}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 font-mono text-sm placeholder:text-surface-400"
              placeholder="Paste the reviewer’s style card (JSON or text) here"
            />
            <p className="mt-1 text-sm text-surface-500">
              Required. Paste the voice/style analysis used to steer this reviewer.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-surface-200 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-surface-300 text-surface-700 rounded hover:bg-surface-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
          >
            {personality ? "Save Changes" : "Create Personality"}
          </button>
        </div>
      </div>
    </div>
  );
}
