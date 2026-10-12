import { z } from "zod";
import type { Config, PrHealth } from "#src/domain/schemas.ts";

const PipelineSchema = z.object({
  number: z.number().int().positive(),
  commit: z.string().min(1),
  status: z.string(),
  errors: z
    .array(z.object({ message: z.string(), is_warning: z.boolean() }))
    .nullish(),
});

/** Inspect structured CI evidence before asking a coding agent to repair it. */
export async function ciOperatorBlocker(input: {
  health: PrHealth;
  headSha: string;
  config: Config["woodpecker"];
  token: string;
}): Promise<string | null> {
  const ci = input.health.checks.find(({ name }) => name === "CI Status");
  if (ci === undefined)
    throw new Error("PR health omitted the CI Status check");
  if (ci.status !== "UNHEALTHY") return null;
  const match = ci.details
    .map((detail) =>
      /^Woodpecker pipeline #(\d+) for exact head [0-9a-f]{12}: [A-Z]+$/.exec(
        detail,
      ),
    )
    .find((value) => value !== null);
  if (match === undefined) return null;
  const number = z.coerce.number().int().positive().parse(match[1]);
  const response = await fetch(
    new URL(
      `/api/repos/${String(input.config.repoId)}/pipelines/${String(number)}`,
      input.config.baseUrl,
    ),
    {
      headers: { Authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Woodpecker pipeline inspection failed (HTTP ${String(response.status)})`,
    );
  const pipeline = PipelineSchema.parse(await response.json());
  if (pipeline.number !== number || pipeline.commit !== input.headSha) {
    throw new Error("Woodpecker pipeline does not match the observed PR head");
  }
  if (
    pipeline.errors?.some(
      ({ message, is_warning: isWarning }) =>
        !isWarning && message.includes("actor is not permitted to run CI"),
    ) === true
  ) {
    return `Woodpecker pipeline #${String(number)} rejected the PR author or sender. An operator must release the reviewed CI authorization fix and rerun exact-head CI; source edits cannot fix this rejection.`;
  }
  return ["declined", "killed", "skipped"].includes(pipeline.status)
    ? `Woodpecker pipeline #${String(number)} is ${pipeline.status}; an operator must restore or rerun exact-head CI before this task can continue.`
    : null;
}
