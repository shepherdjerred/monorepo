import { Button } from "@shepherdjerred/scout-frontend/components/review-tool/ui/button";
import { Dialog } from "@shepherdjerred/scout-frontend/components/review-tool/ui/dialog";
import { Textarea } from "@shepherdjerred/scout-frontend/components/review-tool/ui/textarea";
import { useState } from "react";
import { PromptVariablesInfo, type PromptStageName } from "./prompt-variables-info.tsx";

type PromptEditorProps = {
  label: string;
  prompt: string | undefined;
  defaultPrompt?: string;
  onSave: (next: string | undefined) => void;
  stage?: PromptStageName;
  promptType?: "system" | "user";
};

export function PromptEditor({ label, prompt, defaultPrompt, onSave, stage, promptType }: PromptEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(prompt ?? defaultPrompt ?? "");

  const handleOpen = () => {
    setDraft(prompt ?? defaultPrompt ?? "");
    setOpen(true);
  };

  const handleSave = () => {
    onSave(draft.trim().length > 0 ? draft : undefined);
    setOpen(false);
  };

  const handleReset = () => {
    setDraft(defaultPrompt ?? "");
  };

  const isModified = prompt !== undefined && prompt !== defaultPrompt;

  return (
    <>
      <Button variant="outline" size="sm" type="button" onClick={handleOpen}>
        {isModified ? "Edit prompt (modified)" : "Edit prompt"}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={label}
        className="max-h-[90vh] max-w-4xl overflow-hidden"
      >
        <div className="space-y-4">
          {stage && promptType && <PromptVariablesInfo stage={stage} type={promptType} />}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-700">Prompt template</span>
              {defaultPrompt && (
                <Button variant="ghost" size="sm" type="button" onClick={handleReset}>
                  Reset to default
                </Button>
              )}
            </div>
            <Textarea
              className="h-80 font-mono text-sm"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              placeholder="Enter prompt template..."
              aria-label="Prompt template"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
