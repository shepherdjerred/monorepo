import { EXPLORE_MODEL_OPTIONS, ExploreModelSchema } from "@scout-for-lol/data";
import type { ExploreModel } from "@scout-for-lol/data";

export function ExploreModelControls(props: {
  enabled: boolean;
  model: ExploreModel;
  chooseModel: (model: ExploreModel) => void;
  spending:
    | {
        userRemainingMicros: number;
        globalRemainingMicros: number;
        resetsAt: string;
      }
    | undefined;
}) {
  if (!props.enabled) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-scout-subtle">
      <label className="flex items-center gap-2">
        Model
        <select
          aria-label="Explore model"
          value={props.model}
          onChange={(event) => {
            props.chooseModel(ExploreModelSchema.parse(event.target.value));
          }}
          className="rounded-md border border-scout-border bg-scout-surface px-2 py-1 text-scout-ink"
        >
          {EXPLORE_MODEL_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {props.spending !== undefined && (
        <span title={`Monthly allowance resets ${props.spending.resetsAt}`}>
          Monthly remaining: $
          {(props.spending.userRemainingMicros / 1_000_000).toFixed(2)} personal
          · ${(props.spending.globalRemainingMicros / 1_000_000).toFixed(2)}{" "}
          shared
        </span>
      )}
    </div>
  );
}
