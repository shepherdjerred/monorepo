import { tool } from "ai";
import { z } from "zod";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { scoutExploreSkillLoadsTotal } from "#src/metrics/explore.ts";
import {
  EXPLORE_SKILL_NAMES,
  renderExploreSkillBody,
  type ExploreSkillContext,
} from "#src/explore/skills/registry.ts";
import type { ExploreSkillFile } from "#src/explore/skills/loader.ts";

type LoadSkillResult = {
  ok: boolean;
  instructions: string | null;
  message: string;
};

export type LoadSkillToolInput = {
  /** The skills enabled for this turn — the only ones a load may return. */
  skills: readonly ExploreSkillFile[];
  context: ExploreSkillContext;
  track: ToolTracker;
  /** Lets the turn state remember which skills were loaded (for nudges). */
  onLoaded: (name: string) => void;
};

/**
 * The executor, separate from the AI-SDK `tool()` wrapper so tests can drive
 * it without constructing a `ToolExecutionOptions` (the same split the bucks
 * tools use).
 */
export function createLoadSkillExecutor(input: LoadSkillToolInput) {
  return (skillName: string): Promise<LoadSkillResult> =>
    input.track("load_skill", (): Promise<LoadSkillResult> => {
      const skill = input.skills.find(
        (candidate) => candidate.name === skillName,
      );
      if (skill === undefined) {
        // Model text never becomes a metric label: known-but-disabled names
        // keep their canonical spelling, everything else is one bucket.
        scoutExploreSkillLoadsTotal.inc({
          skill: EXPLORE_SKILL_NAMES.includes(skillName)
            ? skillName
            : "unknown",
          status: "unavailable",
        });
        return Promise.resolve({
          ok: false,
          instructions: null,
          message: `No skill named '${skillName}' is available in this conversation. Available skills: ${input.skills
            .map((candidate) => candidate.name)
            .join(", ")}.`,
        });
      }
      scoutExploreSkillLoadsTotal.inc({ skill: skill.name, status: "loaded" });
      input.onLoaded(skill.name);
      return Promise.resolve({
        ok: true,
        instructions: renderExploreSkillBody(skill, input.context),
        message: "Follow these instructions for the rest of this turn.",
      });
    });
}

/**
 * The generic skill loader, mirroring the Agent Skills pattern: the system
 * prompt carries only an index of names and descriptions, and this tool
 * returns a skill's full instructions when the model needs them.
 *
 * The input schema accepts any string and the enabled-set check happens in
 * the executor: a schema restricted to this turn's enabled names would turn
 * a hallucinated or capability-gated name into an opaque validation error,
 * while a result can say which skills ARE available. It also keeps the tool
 * definition byte-stable across capability combinations, which preserves the
 * provider-side prompt-cache prefix.
 */
export function createLoadSkillTool(input: LoadSkillToolInput) {
  const execute = createLoadSkillExecutor(input);
  return tool({
    description:
      "Load the full instructions for one of the skills listed in the system prompt's Skills index. Call it before using that skill's tools or doing what its description covers. Costs no query budget.",
    inputSchema: z.strictObject({ skill: z.string().min(1).max(100) }),
    outputSchema: z.strictObject({
      ok: z.boolean(),
      instructions: z.string().nullable(),
      message: z.string(),
    }),
    execute: (inputData) => execute(inputData.skill),
  });
}
