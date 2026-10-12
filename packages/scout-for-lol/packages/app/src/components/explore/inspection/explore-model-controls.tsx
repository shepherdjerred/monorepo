import { z } from "zod";
const ModelSchema = z.enum(["gpt-6-luna", "gpt-6.1-sol"]);

export function ExploreModelControls(props: {
  enabled: boolean;
  model: z.infer<typeof ModelSchema>;
  chooseModel: (model: z.infer<typeof ModelSchema>) => void;
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
            props.chooseModel(ModelSchema.parse(event.target.value));
          }}
          className="rounded-md border border-scout-border bg-scout-surface px-2 py-1 text-scout-ink"
        >
          <option value="gpt-6-luna">GPT-6 Luna · High</option>
          <option value="gpt-6.1-sol">GPT-6.1 Sol · High</option>
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
