import { expect, test } from "vitest";
import { flagDeployments } from "./deployments.ts";
import {
  describeInvalidFlagValue,
  diffProjectedDeploymentFlags,
  FlagsDiffResponseSchema,
} from "./flags-drift.ts";
import { projectDeploymentFlags } from "./project-deployment.ts";

const delivery = flagDeployments.find(
  (deployment) => deployment.id === "delivery/prod",
);

test("a projected document has no invalid values", () => {
  for (const deployment of flagDeployments) {
    const diff = diffProjectedDeploymentFlags(deployment, {
      revision: 1,
      flags: projectDeploymentFlags(deployment),
    });
    expect(diff.invalid).toEqual([]);
  }
});

test("invalid live variant values are reported alongside drift, not thrown", () => {
  if (delivery === undefined) throw new Error("delivery/prod missing");
  const flags = projectDeploymentFlags(delivery).map((flag) =>
    flag.key === "delivery-enabled-environments" && flag.type === "variant"
      ? { ...flag, value: '["delivery/prod", 7]' }
      : flag.key === "delivery-lease-seconds" && flag.type === "variant"
        ? { ...flag, value: "soon" }
        : flag,
  );
  const diff = diffProjectedDeploymentFlags(delivery, { revision: 4, flags });
  expect(diff.drift.map((entry) => entry.key)).toEqual([
    "delivery-enabled-environments",
    "delivery-lease-seconds",
  ]);
  expect(diff.invalid).toEqual([
    {
      key: "delivery-enabled-environments",
      value: '["delivery/prod", 7]',
      issues: [
        {
          path: "/1",
          message: "Invalid input: expected string, received number",
        },
      ],
    },
    {
      key: "delivery-lease-seconds",
      value: "soon",
      issues: [{ path: "", message: 'Expected a decimal number, got "soon"' }],
    },
  ]);
  expect(
    FlagsDiffResponseSchema.safeParse({ deployments: [diff] }).success,
  ).toBe(true);
  expect(diff.invalid.map((entry) => describeInvalidFlagValue(entry))).toEqual([
    String.raw`delivery-enabled-environments: live value "[\"delivery/prod\", 7]" fails its value schema (/1: Invalid input: expected string, received number)`,
    'delivery-lease-seconds: live value "soon" fails its value schema (Expected a decimal number, got "soon")',
  ]);
});

test("extra live keys are not schema-checked", () => {
  if (delivery === undefined) throw new Error("delivery/prod missing");
  const diff = diffProjectedDeploymentFlags(delivery, {
    revision: 1,
    flags: [
      ...projectDeploymentFlags(delivery),
      { type: "variant", key: "mail-settings", value: "{" },
    ],
  });
  expect(diff.extra).toEqual(["mail-settings"]);
  expect(diff.invalid).toEqual([]);
});

test("a diff from a Flags server without the value registry parses with no invalid values", () => {
  const parsed = FlagsDiffResponseSchema.parse({
    deployments: [
      { id: "delivery/prod", revision: 3, missing: [], extra: [], drift: [] },
    ],
  });
  expect(parsed.deployments[0]?.invalid).toEqual([]);
});
