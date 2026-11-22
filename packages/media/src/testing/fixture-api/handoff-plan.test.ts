import { expect, test } from "vitest";
import {
  HANDOFF_IDS,
  handoffDetail,
} from "#testing/fixture-api/fixtures/handoff.ts";
import {
  HANDOFF_PLAN_STATES,
  HandoffPlanDetailSchema,
} from "#client/library-import/plan-detail.ts";

async function source(path: string): Promise<string> {
  return Bun.file(new URL(path, import.meta.url)).text();
}

/**
 * The states the server writes onto an adoption plan: the column's default,
 * and every `state:` literal in the four files that create or move a plan.
 */
async function serverStates(): Promise<string[]> {
  const states = new Set<string>();
  const schema = await source("../../../prisma/schema.prisma");
  const model =
    /model MediaHandoffPlan \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";
  for (const found of model.matchAll(/state String @default\("(\w+)"\)/gu)) {
    states.add(found[1] ?? "");
  }
  for (const file of [
    "../../automation/handoff/plan.ts",
    "../../automation/handoff/apply.ts",
    "../../automation/handoff/plex-edit-facets.ts",
    "../../infrastructure/handoff/service.ts",
  ]) {
    const text = await source(file);
    for (const call of text.matchAll(
      /mediaHandoffPlan\.(?:update|create)\(/gu,
    )) {
      const window = text.slice(call.index, call.index + 700);
      for (const found of window.matchAll(/\bstate:\s*"(\w+)"/gu)) {
        states.add(found[1] ?? "");
      }
    }
  }
  return [...states].sort();
}

test("the page reads exactly the plan states the server writes", async () => {
  expect([...HANDOFF_PLAN_STATES].sort()).toEqual(await serverStates());
});

test("a plan the server stopped for review is read, not rejected", () => {
  const stopped = handoffDetail(HANDOFF_IDS.requiresReview);
  expect(stopped?.state).toBe("requires_review");
  expect(HandoffPlanDetailSchema.safeParse(stopped).success).toBe(true);
});
