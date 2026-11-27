import { expect, test } from "vitest";
import {
  deploymentCounts,
  driftPath,
  driftSeverity,
  itemCount,
  remedy,
  totalCounts,
  worstFirst,
  type DeploymentDrift,
} from "./drift-model.ts";

const clean: DeploymentDrift = {
  id: "golink/prod",
  revision: 3,
  missing: [],
  extra: [],
  drift: [],
  invalid: [],
};

const dirty: DeploymentDrift = {
  id: "scout/prod",
  revision: 7,
  missing: [{ type: "boolean", key: "new_flag", default: false, rollouts: [] }],
  extra: ["old_flag"],
  drift: [
    {
      key: "dares",
      live: { type: "boolean", key: "dares", default: true, rollouts: [] },
      declared: { type: "boolean", key: "dares", default: false, rollouts: [] },
    },
  ],
  invalid: [
    {
      key: "budget",
      value: "-1",
      issues: [{ path: "", message: "Too small" }],
    },
  ],
};

test("counts, totals and the worst severity", () => {
  expect(deploymentCounts(clean)).toEqual({
    invalid: 0,
    drift: 0,
    missing: 0,
    extra: 0,
  });
  const totals = totalCounts([clean, dirty, dirty]);
  expect(totals).toEqual({ invalid: 2, drift: 2, missing: 2, extra: 2 });
  expect(itemCount(totals)).toBe(8);
  expect(driftSeverity(deploymentCounts(clean))).toBe("ok");
  expect(driftSeverity(totals)).toBe("error");
  expect(driftSeverity({ invalid: 0, drift: 1, missing: 1, extra: 0 })).toBe(
    "warning",
  );
  expect(driftSeverity({ invalid: 0, drift: 0, missing: 0, extra: 1 })).toBe(
    "info",
  );
  const onlyDrift: DeploymentDrift = { ...dirty, id: "a/prod", invalid: [] };
  expect(
    worstFirst([clean, onlyDrift, dirty]).map((entry) => entry.id),
  ).toEqual(["scout/prod", "a/prod", "golink/prod"]);
  expect(driftPath()).toBe("/drift");
  expect(driftPath("scout/prod")).toBe("/drift#scout/prod");
});

test("remedies name the documented commands for the deployment and keys", () => {
  const origin = "https://flags.example.test";
  expect(remedy("missing", dirty, origin).commands).toEqual([
    'FLAGS_URL="https://flags.example.test" toolkit run --env FLAGS_MACHINE_TOKEN -- bun run check-flag-inventory -- --deployment scout/prod --apply-missing',
  ]);
  expect(remedy("drift", dirty, origin).commands).toEqual([
    'FLAGS_URL="https://flags.example.test" bun run check-flag-inventory -- --plan-declared --deployment scout/prod --flag dares --json',
    'FLAGS_URL="https://flags.example.test" toolkit run --env FLAGS_MACHINE_TOKEN -- bun run check-flag-inventory -- --apply-declared --deployment scout/prod --flag dares --json',
  ]);
  expect(remedy("invalid", dirty, origin).commands).toEqual([
    "toolkit flags get scout/prod budget --json",
    "toolkit flags apply --file reviewed.json",
  ]);
  expect(remedy("extra", dirty, origin).commands).toEqual([]);
});
