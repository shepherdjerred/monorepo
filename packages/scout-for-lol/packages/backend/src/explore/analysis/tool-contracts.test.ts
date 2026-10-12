import { expect, test } from "vitest";
import { z } from "zod";
import { createLoadSkillTool } from "#src/explore/skills/tool.ts";
import {
  registerExploreToolContracts,
  inspectRegisteredTool,
} from "#src/explore/inspection/tool-contracts.ts";
import { sharedToolPayload } from "#src/explore/inspection/tool-payloads.ts";

test("skill inspection uses the executing tool's exact contracts", () => {
  registerExploreToolContracts({
    load_skill: createLoadSkillTool({
      skills: [],
      context: { bucks: null, surface: "web" },
      track: async (_name, execute) => await execute(),
      onLoaded: () => {
        /* No skill was executed in this contract test. */
      },
    }),
  });
  expect(
    inspectRegisteredTool("load_skill", "input", { skill: "data-analysis" }),
  ).toEqual({ skill: "data-analysis" });
  expect(
    inspectRegisteredTool("load_skill", "output", {
      ok: true,
      instructions: "Exact body",
      message: "Loaded",
    }),
  ).toMatchObject({ instructions: "Exact body" });
  expect(() =>
    inspectRegisteredTool("load_skill", "input", {
      skill: "x",
      invented: true,
    }),
  ).toThrow(z.ZodError);
});

test("public evidence removes server scope and private contracts remain redacted", () => {
  expect(
    sharedToolPayload("run_report_query", {
      queryText: "FROM matches SELECT games",
      servers: ["private-server"],
    }),
  ).toEqual({ queryText: "FROM matches SELECT games" });
  expect(
    JSON.stringify(
      sharedToolPayload("create_dare", {
        ok: true,
        token: "private-token",
        servers: ["private-server"],
        amount: 1234,
      }),
    ),
  ).not.toMatch(/private-token|private-server|1234/u);
  expect(
    sharedToolPayload("new_private_tool", { unknown: "private" }),
  ).toMatchObject({ redacted: expect.any(String) });
});
