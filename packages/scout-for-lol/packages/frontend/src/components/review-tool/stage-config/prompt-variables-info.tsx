/**
 * Component showing available prompt variables for each pipeline stage
 *
 * This imports variable definitions from @scout-for-lol/data to ensure
 * the frontend stays in sync with the backend. If variables are added
 * or renamed in the data package, TypeScript will catch any mismatches.
 */
import type { PROMPT_STAGE_NAMES } from "@scout-for-lol/data";
import { STAGE_PROMPT_VARIABLES } from "@scout-for-lol/data";

/**
 * Define PromptStageName locally derived from the data package constant.
 * This ensures type safety while avoiding re-export lint errors.
 */
export type PromptStageName = (typeof PROMPT_STAGE_NAMES)[number];

type PromptVariablesInfoProps = {
  stage: PromptStageName;
  type: "system" | "user";
};

export function PromptVariablesInfo({ stage, type }: PromptVariablesInfoProps) {
  const stageVars = STAGE_PROMPT_VARIABLES[stage];

  const variables = type === "system" ? stageVars.system : stageVars.user;

  if (variables.length === 0) {
    return (
      <p className="text-xs text-scout-subtle italic">
        No variables available for this prompt.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-scout-ink">Available variables:</p>
      <div className="space-y-1 rounded-md bg-scout-raised p-2">
        {variables.map((v) => (
          <div key={v.name} className="flex items-start gap-2 text-xs">
            <code className="shrink-0 rounded bg-scout-raised px-1 py-0.5 font-mono text-scout-ink">{`<${v.name}>`}</code>
            <span className="text-scout-subtle">{v.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
