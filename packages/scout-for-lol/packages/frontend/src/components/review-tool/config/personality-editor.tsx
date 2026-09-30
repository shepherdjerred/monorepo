/**
 * Personality editor modal for creating/editing personalities
 */
import { useState } from "react";
import { z } from "zod";
import type {
  Personality,
  PersonalityMetadata,
} from "#src/lib/review-tool/config/schema.ts";
import { PersonalitySchema } from "#src/lib/review-tool/config/schema.ts";

const ErrorSchema = z.object({ message: z.string() });

type PersonalityEditorProps = {
  personality?: Personality | undefined;
  onSave: (personality: Personality) => void;
  onCancel: () => void;
};

export function PersonalityEditor({
  personality,
  onSave,
  onCancel,
}: PersonalityEditorProps) {
  const [name, setName] = useState(personality?.metadata.name ?? "");
  const [instructions, setInstructions] = useState(
    personality?.instructions ?? "",
  );
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
    } catch (error_) {
      const errorResult = ErrorSchema.safeParse(error_);
      setError(errorResult.success ? errorResult.data.message : String(error_));
    }
  };

  return (
    <div className="fixed inset-0 bg-scout-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-scout-surface rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-scout-border sticky top-0 bg-scout-surface">
          <h2 className="text-2xl font-bold text-scout-ink">
            {personality ? "Edit Personality" : "Create New Personality"}
          </h2>
        </div>

        <div className="p-6 space-y-6">
          {error !== null && error.length > 0 && (
            <div className="p-4 bg-scout-danger border border-scout-danger rounded text-scout-danger-ink">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="personality-name"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Name <span className="text-scout-danger">*</span>
            </label>
            <input
              id="personality-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="e.g., Friendly Coach"
            />
          </div>

          <div>
            <label
              htmlFor="personality-instructions"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Instructions / System Prompt{" "}
              <span className="text-scout-danger">*</span>
            </label>
            <textarea
              id="personality-instructions"
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
              }}
              rows={15}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand font-mono text-sm placeholder:text-scout-subtle"
              placeholder="Detailed instructions for how this reviewer should behave and write reviews..."
            />
            <p className="mt-1 text-sm text-scout-subtle">
              This is the system prompt that defines how the reviewer thinks and
              writes.
            </p>
          </div>

          <div>
            <label
              htmlFor="personality-style-card"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Style Card (required)
            </label>
            <textarea
              id="personality-style-card"
              value={styleCard}
              onChange={(e) => {
                setStyleCard(e.target.value);
              }}
              rows={12}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand font-mono text-sm placeholder:text-scout-subtle"
              placeholder="Paste the reviewer’s style card (JSON or text) here"
            />
            <p className="mt-1 text-sm text-scout-subtle">
              Required. Paste the voice/style analysis used to steer this
              reviewer.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-scout-border flex justify-end gap-3 sticky bottom-0 bg-scout-surface">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-scout-border text-scout-ink rounded hover:bg-scout-raised transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-scout-brand text-scout-brand-ink rounded hover:bg-scout-brand transition-colors"
          >
            {personality ? "Save Changes" : "Create Personality"}
          </button>
        </div>
      </div>
    </div>
  );
}
