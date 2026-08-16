import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import { Switch } from "@scout-for-lol/design-system/components/switch";
import type { ImageGenerationStageConfig } from "#src/lib/review-tool/config/schema.ts";
import { IMAGE_GENERATION_USER_PROMPT } from "@scout-for-lol/data";
import { PromptEditor } from "./prompt-editor.tsx";

type ImageGenerationPanelProps = {
  config: ImageGenerationStageConfig;
  onChange: (next: ImageGenerationStageConfig) => void;
};

export function ImageGenerationPanel({
  config,
  onChange,
}: ImageGenerationPanelProps) {
  return (
    <Card>
      <CardHeader className="flex items-start justify-between">
        <div>
          <CardTitle>Stage 4: Image Generation</CardTitle>
          <p className="mt-1 text-xs text-scout-subtle">
            OpenRouter image generation settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-scout-subtle">Enabled</span>
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => {
              onChange({ ...config, enabled });
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="imageModel">Model</Label>
            <Input
              id="imageModel"
              value={config.model}
              onChange={(e) => {
                onChange({ ...config, model: e.target.value });
              }}
              placeholder="gemini-3-pro-image-preview"
            />
          </div>
          <div>
            <Label htmlFor="timeoutMs">Timeout (ms)</Label>
            <Input
              id="timeoutMs"
              type="number"
              min={5000}
              max={300_000}
              value={config.timeoutMs}
              onChange={(e) => {
                onChange({
                  ...config,
                  timeoutMs: Number.parseInt(e.target.value, 10),
                });
              }}
            />
          </div>
        </div>

        {/* User Prompt Editor for Image Generation */}
        <div className="flex items-center justify-between rounded-md border border-scout-border px-3 py-2">
          <div>
            <Label className="text-xs text-scout-subtle">
              User prompt template
            </Label>
            <p className="text-xs text-scout-subtle">
              Template for the OpenRouter image generation request.
            </p>
          </div>
          <PromptEditor
            label="Image Generation - User Prompt Template"
            prompt={config.userPrompt}
            defaultPrompt={IMAGE_GENERATION_USER_PROMPT}
            stage="imageGeneration"
            promptType="user"
            onSave={(next) => {
              onChange({ ...config, userPrompt: next });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
