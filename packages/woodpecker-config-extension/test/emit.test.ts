import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  WORKFLOW_TIMEOUT_MINUTES,
  emitWorkflow,
  wrapCommands,
} from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, testPipelineSteps } from "./identity.ts";

/** What Woodpecker's envsubst does to text that holds only escaped `$`. */
function substitute(yaml: string): string {
  return yaml.replaceAll("$$", () => "$");
}

const EmittedCommands = z.object({
  steps: z.tuple([z.object({ commands: z.array(z.string()) })]),
});

describe("variable substitution", () => {
  const steps = testPipelineSteps();

  /**
   * An odd run is a `$` envsubst would read as the start of a substitution:
   * a braced one is rewritten or rejects the whole pipeline.
   */
  test("leaves no unescaped `$` in any workflow", () => {
    for (const step of steps) {
      const runs = emitWorkflow(step, TEST_IDENTITY).match(/\$+/gu) ?? [];
      for (const run of runs) {
        expect(run.length % 2, `${step.key} has an unescaped $`).toBe(0);
      }
    }
  });

  test("hands every step back its exact commands", () => {
    for (const step of steps) {
      const parsed = EmittedCommands.parse(
        parse(substitute(emitWorkflow(step, TEST_IDENTITY))),
      );
      expect(parsed.steps[0].commands, step.key).toEqual(wrapCommands(step));
    }
  });

  /** The bash array expansions that made Woodpecker refuse to compile. */
  test("keeps bash array expansions intact", () => {
    const sites = steps.find((step) => step.key === "sites");
    expect(sites).toBeDefined();
    if (sites === undefined) return;
    const command = EmittedCommands.parse(
      parse(substitute(emitWorkflow(sites, TEST_IDENTITY))),
    ).steps[0].commands[0];
    expect(command).toContain('"${filters[@]}"');
    expect(command).toContain("${#filters[@]}");
  });
});

/** Clone, image pull, and pod start all count against the workflow timeout. */
const WORKFLOW_OVERHEAD_MINUTES = 15;

describe("workflow timeout", () => {
  /**
   * Woodpecker kills the whole workflow at the repository timeout, so a step
   * budgeted past it would be cut off mid-run rather than by its own bound.
   */
  test("fits every step's worst case inside it", () => {
    for (const step of testPipelineSteps()) {
      const attempts = Math.max(step.retries ?? 1, 1);
      expect(
        step.timeoutMinutes * attempts + WORKFLOW_OVERHEAD_MINUTES,
        step.key,
      ).toBeLessThanOrEqual(WORKFLOW_TIMEOUT_MINUTES);
    }
  });
});
