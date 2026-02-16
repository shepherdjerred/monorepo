import { Input } from "@scout-for-lol/frontend/components/review-tool/ui/input";
import { Label } from "@scout-for-lol/frontend/components/review-tool/ui/label";
import type { ModelConfig } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import { modelSupportsParameter } from "@scout-for-lol/data";
import type { ChangeEvent } from "react";

type ModelConfigFormProps = {
  value: ModelConfig;
  onChange: (next: ModelConfig) => void;
};

function handleNumberChange(
  event: ChangeEvent<HTMLInputElement>,
  fallback: number,
): number {
  const parsed = Number.parseInt(event.target.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ModelConfigForm({ value, onChange }: ModelConfigFormProps) {
  const supportsTemperature = modelSupportsParameter(
    value.model,
    "temperature",
  );
  const supportsTopP = modelSupportsParameter(value.model, "topP");

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <Label htmlFor="model">Model</Label>
        <Input
          id="model"
          value={value.model}
          onChange={(e) => {
            onChange({ ...value, model: e.target.value });
          }}
          placeholder="gpt-4o-mini"
        />
      </div>
      <div>
        <Label htmlFor="maxTokens">Max tokens</Label>
        <Input
          id="maxTokens"
          type="number"
          min={100}
          max={100000}
          value={value.maxTokens}
          onChange={(e) => {
            onChange({
              ...value,
              maxTokens: handleNumberChange(e, value.maxTokens),
            });
          }}
        />
      </div>
      <div>
        <Label htmlFor="temperature">
          Temperature
          {!supportsTemperature && (
            <span className="ml-1 text-xs text-amber-600">(unsupported)</span>
          )}
        </Label>
        <Input
          id="temperature"
          type="number"
          step="0.05"
          min={0}
          max={2}
          value={value.temperature ?? ""}
          onChange={(e) => {
            const next = Number.parseFloat(e.target.value);
            onChange({
              ...value,
              temperature: Number.isFinite(next) ? next : undefined,
            });
          }}
          placeholder="0.7"
          disabled={!supportsTemperature}
        />
      </div>
      <div>
        <Label htmlFor="topP">
          Top P
          {!supportsTopP && (
            <span className="ml-1 text-xs text-amber-600">(unsupported)</span>
          )}
        </Label>
        <Input
          id="topP"
          type="number"
          step="0.05"
          min={0}
          max={1}
          value={value.topP ?? ""}
          onChange={(e) => {
            const next = Number.parseFloat(e.target.value);
            onChange({
              ...value,
              topP: Number.isFinite(next) ? next : undefined,
            });
          }}
          placeholder="0.9"
          disabled={!supportsTopP}
        />
      </div>
    </div>
  );
}
