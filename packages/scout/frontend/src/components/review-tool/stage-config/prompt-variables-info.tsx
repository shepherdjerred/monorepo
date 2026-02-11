/**
 * Component showing available prompt variables for each pipeline stage
 *
 * This imports variable definitions from @shepherdjerred/scout-data to ensure
 * the frontend stays in sync with the backend. If variables are added
 * or renamed in the data package, TypeScript will catch any mismatches.
 */
import type { PROMPT_STAGE_NAMES } from "@shepherdjerred/scout-data";
import { STAGE_PROMPT_VARIABLES } from "@shepherdjerred/scout-data";

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
    return <p className="text-xs text-surface-500 italic">No variables available for this prompt.</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-surface-700">Available variables:</p>
      <div className="space-y-1 rounded-md bg-surface-50 p-2">
        {variables.map((v) => (
          <div key={v.name} className="flex items-start gap-2 text-xs">
            <code className="shrink-0 rounded bg-surface-200 px-1 py-0.5 font-mono text-surface-800">{`<${v.name}>`}</code>
            <span className="text-surface-600">{v.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
