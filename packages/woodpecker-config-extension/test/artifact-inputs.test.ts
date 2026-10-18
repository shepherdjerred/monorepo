import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  buildPipelineSteps,
  credentiallessHostedAutomationSteps,
} from "#src/pipeline/steps.ts";
import { TEST_IMAGES as IMAGES } from "./identity.ts";
const allSteps = () =>
  buildPipelineSteps({
    images: IMAGES,
    changedBase: "x",
    deliveryPublication: true,
  });
const step = (key: string) => allSteps().find((s) => s.key === key);

function dependsTransitivelyOn(
  steps: readonly { key: string; dependsOn?: readonly string[] }[],
  key: string,
  target: string,
): boolean {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const dependency of byKey.get(current)?.dependsOn ?? []) {
      if (dependency === target) return true;
      stack.push(dependency);
    }
  }
  return false;
}

describe("artifact producers and consumers line up", () => {
  const producedBy = new Map<string, string>();
  const consumedBy: { key: string; artifact: string }[] = [];

  for (const candidate of allSteps()) {
    const command = candidate.commands.join("\n");
    for (const put of command.matchAll(
      /ci-artifact\.ts put (?<name>[\w-]+)/gu,
    )) {
      if (put.groups?.["name"] !== undefined) {
        producedBy.set(put.groups["name"], candidate.key);
      }
    }
    for (const get of command.matchAll(
      /ci-artifact\.ts get (?<name>[\w-]+)/gu,
    )) {
      if (get.groups?.["name"] !== undefined) {
        consumedBy.push({ key: candidate.key, artifact: get.groups["name"] });
      }
    }
  }

  test("at least one artifact is exchanged", () => {
    expect(consumedBy.length).toBeGreaterThan(0);
  });

  test("each consumed artifact has a producer upstream of it", () => {
    for (const { key, artifact } of consumedBy) {
      const producer = producedBy.get(artifact);
      expect(producer, `${artifact} has no producer`).toBeDefined();
      if (producer === undefined) continue;
      expect(
        dependsTransitivelyOn(allSteps(), key, producer),
        `${key} consumes ${artifact} but does not depend on ${producer}`,
      ).toBe(true);
    }
  });
});

/**
 * Handoffs published from inside a script rather than by a lane command.
 *
 * bake-images.ts writes these three itself, so they are invisible to a scan
 * of the lane commands. Declaring them keeps the upstream-dependency check
 * meaningful and records the coupling: if that script stops publishing one,
 * this list is where the consumers are named.
 */
const SCRIPT_PUBLISHED_HANDOFFS: Readonly<Record<string, string>> = {
  "image-digests": "images",
  "delivery-image-digests": "images",
  "version-catalog": "images",
  "pin-candidates": "images",
};

/** Same invariant for the JSON handoff store. */
describe("handoff producers and consumers line up", () => {
  test("each required handoff read has a producer upstream of it", () => {
    const steps = allSteps();
    const producedBy = new Map<string, string>(
      Object.entries(SCRIPT_PUBLISHED_HANDOFFS),
    );
    for (const candidate of steps) {
      for (const command of candidate.commands) {
        const put = /write-ci-handoff\.ts (?<name>[\w-]+)/u.exec(command);
        if (put?.groups?.["name"] !== undefined) {
          producedBy.set(put.groups["name"], candidate.key);
        }
      }
    }
    for (const candidate of steps) {
      for (const command of candidate.commands) {
        const get = /read-ci-handoff\.ts (?<name>[\w-]+)/u.exec(command);
        const artifact = get?.groups?.["name"];
        if (artifact === undefined) continue;
        const producer = producedBy.get(artifact);
        expect(producer, `${artifact} has no producer`).toBeDefined();
        if (producer === undefined) continue;
        expect(
          dependsTransitivelyOn(steps, candidate.key, producer),
          `${candidate.key} reads ${artifact} but does not depend on ${producer}`,
        ).toBe(true);
      }
    }
  });
});

test("the sites lane installs and pre-builds the Storybook catalogs", () => {
  const sites = step("sites");
  if (sites === undefined) throw new Error("sites step missing");
  const commands = sites.commands.join("\n");

  expect(commands).toContain(
    "ci/scripts/selectors/ci-changed.ts site-scout-design-system",
  );
  expect(commands).toContain(
    "--filter '@scout-for-lol/design-system' --filter '@scout-for-lol/app' --filter '@shepherdjerred/llm-models' --filter '@shepherdjerred/glitter-context'",
  );
  expect(commands).toContain(
    "bun --no-install run --cwd packages/llm-models build",
  );
  expect(commands).toContain(
    "bun --no-install run --cwd packages/glitter-context build",
  );
  expect(commands).toContain(
    "bun --no-install scripts/release/deploy-site.ts scout-design-system",
  );
  expect(commands).not.toContain("turbo run");
});

test("the sites lane publishes active site archives when their paths change", () => {
  const sites = step("sites");
  const dryRun = step("pr-dryrun");
  if (sites === undefined || dryRun === undefined) {
    throw new Error("site deploy or dry-run step missing");
  }
  expect(dryRun.commands.join("\n")).not.toContain("--version-catalog-file");
  expect(dryRun.commands.join("\n")).toContain(
    `--backend-digest sha256:${"f".repeat(64)}`,
  );
  const commands = sites.commands.join("\n");
  for (const [lane, site, workspace] of [
    [
      "site-statically-typed",
      "statically-typed",
      "@shepherdjerred/statically-typed",
    ],
    ["site-ts-mc-docs", "ts-mc-docs", "@shepherdjerred/ts-mc-docs"],
  ] as const) {
    expect(commands).toContain(`ci/scripts/selectors/ci-changed.ts ${lane}`);
    expect(commands).toContain(`--filter '${workspace}'`);
    expect(commands).toContain(
      `bun --no-install scripts/release/deploy-site.ts ${site}`,
    );
    expect(dryRun.commands.join("\n")).toContain(site);
  }
  const loop = /for site in ([^\n]+); do/u.exec(
    dryRun.commands.join("\n"),
  )?.[1];
  expect(loop?.split(" ")).not.toContain("ts-mc");
});

test("Glitter Boys artifacts are excluded from shared CI", async () => {
  const steps = allSteps();
  for (const key of ["sites", "pr-dryrun"]) {
    const commands = steps
      .find((entry) => entry.key === key)
      ?.commands.join("\n");
    expect(commands).toBeDefined();
    expect(commands).not.toContain("glitter-boys");
  }
  for (const pipeline of [steps, credentiallessHostedAutomationSteps(IMAGES)]) {
    const verify = pipeline
      .find((entry) => entry.key === "verify")
      ?.commands.join("\n")
      .replaceAll(String.raw`'\''`, "'");
    expect(verify).toContain("--filter='!@shepherdjerred/glitter-boys'");
    expect(verify).toContain(
      "--filter='!@shepherdjerred/glitter-boys-launcher'",
    );
  }
  // Homelab imports the publication contract through a workspace dependency.
  // Its inherited ^build must not compile the native application in CI.
  const launcher = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(
      await Bun.file(
        new URL("../../glitter-boys-launcher/package.json", import.meta.url),
      ).json(),
    );
  expect(launcher.scripts["build"]).toBeUndefined();
  expect(launcher.scripts["build:local"]).toContain("cargo build");
  expect(launcher.scripts["test:ci"]).toBeUndefined();
});

test("the sites lane selects every declared per-site change filter", async () => {
  const sites = step("sites");
  if (sites === undefined) throw new Error("sites step missing");
  const selectorSource = await Bun.file(
    new URL(
      "../../../ci/scripts/selectors/site-lane-paths.ts",
      import.meta.url,
    ),
  ).text();
  const lanes = [...selectorSource.matchAll(/"(site-[^"]+)": \[/gu)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  expect(lanes.length).toBeGreaterThan(0);
  const commands = sites.commands.join("\n");
  for (const lane of lanes) {
    expect(commands).toContain(`ci/scripts/selectors/ci-changed.ts ${lane}`);
  }
});
