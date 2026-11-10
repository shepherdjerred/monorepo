import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { SYNTHESIZED_STACKS } from "#src/app.ts";
import {
  staleStacks,
  synthesize,
  synthesizedConfigurationPath,
  withoutGeneratorMetadata,
} from "#scripts/synth.ts";

const PackageSchema = z.object({
  dependencies: z.object({ cdktn: z.string() }),
});

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown().optional(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  variable: z.record(z.string(), z.unknown()).optional(),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  import: z.array(z.object({ to: z.string(), id: z.string() })).optional(),
  removed: z.array(z.looseObject({ from: z.string() })).optional(),
});

async function configuration(stack: (typeof SYNTHESIZED_STACKS)[number]) {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(JSON.parse(synthesized.get(stack) ?? ""));
}

function addresses(resource: Record<string, Record<string, unknown>>) {
  return Object.entries(resource)
    .flatMap(([type, byName]) =>
      Object.keys(byName).map((name) => `${type}.${name}`),
    )
    .toSorted();
}

describe("synthesized OpenTofu configuration", () => {
  test("every committed main.tf.json equals a fresh synthesis", async () => {
    expect(await staleStacks()).toEqual([]);
  });

  test("every directory holding a main.tf.json is a stack of this app", async () => {
    const committed = await Array.fromAsync(
      new Bun.Glob("*/main.tf.json").scan({
        cwd: path.dirname(path.dirname(synthesizedConfigurationPath("github"))),
      }),
    );
    expect(committed.map((file) => path.dirname(file)).toSorted()).toEqual(
      SYNTHESIZED_STACKS.toSorted(),
    );
  });

  test("github keeps the addresses, imports and forgotten webhook of its state", async () => {
    const github = await configuration("github");
    expect(addresses(github.resource)).toEqual([
      "github_repository.monorepo",
      "github_repository.shepherdjerred",
      "github_repository_ruleset.monorepo_main",
      "github_repository_webhook.pr_bot",
    ]);
    expect(github.import).toEqual([
      {
        id: "monorepo:11098884",
        to: "github_repository_ruleset.monorepo_main",
      },
      { id: "monorepo/616025071", to: "github_repository_webhook.pr_bot" },
    ]);
    expect(github.removed).toEqual([
      {
        from: "github_repository_webhook.buildkite",
        lifecycle: { destroy: false },
      },
    ]);
    expect(
      github.resource["github_repository_webhook"]?.["pr_bot"],
    ).toMatchObject({ lifecycle: { ignore_changes: "all" } });
    // The lock file records this constraint; a different one rewrites it.
    expect(github.terraform.required_providers["github"]?.version).toBe(
      "~> 6.12",
    );
    expect(github.terraform.encryption).toBeUndefined();
  });
});

describe("generator metadata", () => {
  test("drops cdktn's comment keys at every depth and nothing else", () => {
    expect(
      withoutGeneratorMetadata({
        "//": { metadata: { version: "0.25.0", stackName: "github" } },
        resource: {
          github_repository: {
            monorepo: {
              "//": { metadata: { path: "github/monorepo" } },
              name: "monorepo",
              topics: ["//", { "//": "nested", kept: true }],
            },
          },
        },
      }),
    ).toEqual({
      resource: {
        github_repository: {
          monorepo: { name: "monorepo", topics: ["//", { kept: true }] },
        },
      },
    });
  });

  test("a cdktn release cannot change a committed stack through its metadata", async () => {
    const { dependencies } = PackageSchema.parse(
      await Bun.file(path.join(import.meta.dir, "../package.json")).json(),
    );
    for (const [stack, content] of await synthesize()) {
      expect(content, stack).not.toContain('"//"');
      expect(content, stack).not.toContain(`"${dependencies.cdktn}"`);
      expect(
        await Bun.file(synthesizedConfigurationPath(stack)).text(),
        stack,
      ).not.toContain('"//"');
    }
  });
});
