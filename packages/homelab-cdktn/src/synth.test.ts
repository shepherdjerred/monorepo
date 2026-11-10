import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
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
  moved: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  locals: z.record(z.string(), z.unknown()).optional(),
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

describe("dockerhub", () => {
  test("keeps one protected repository per registered image, its imports and retirements", async () => {
    const dockerhub = await configuration("dockerhub");
    expect(addresses(dockerhub.resource)).toEqual([
      "docker_hub_repository.image",
    ]);
    expect(
      dockerhub.resource["docker_hub_repository"]?.["image"],
    ).toMatchObject({
      for_each: "${local.images}",
      name: "${each.key}",
      namespace: "${local.registry.namespace}",
      private: '${(each.value.visibility == "private")}',
      lifecycle: { prevent_destroy: true },
    });
    // The for_each keys come from the registry the stack imports.
    expect(dockerhub.locals).toEqual({
      registry: imageRegistry,
      images: "${{ for image in local.registry.images : image.name => image }}",
    });
    expect(dockerhub.import).toEqual([
      {
        id: "shepherdjerred/delivery",
        to: 'docker_hub_repository.image["delivery"]',
      },
      {
        id: "shepherdjerred/media",
        to: 'docker_hub_repository.image["media"]',
      },
    ]);
    expect(dockerhub.moved).toEqual([
      {
        from: 'docker_hub_repository.image["discord-plays-pokemon"]',
        to: "docker_hub_repository.retired_discord_plays_pokemon",
      },
      {
        from: 'docker_hub_repository.image["discord-plays-mario-kart"]',
        to: "docker_hub_repository.retired_discord_plays_mario_kart",
      },
    ]);
    expect(dockerhub.removed).toEqual([
      {
        from: "docker_hub_repository.retired_discord_plays_pokemon",
        lifecycle: { destroy: false },
      },
      {
        from: "docker_hub_repository.retired_discord_plays_mario_kart",
        lifecycle: { destroy: false },
      },
    ]);
    expect(dockerhub.terraform.required_providers["docker"]).toEqual({
      source: "docker/docker",
      version: "0.7.0",
    });
    expect(dockerhub.terraform.encryption).toMatchObject({
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
    expect(Object.keys(dockerhub.variable ?? {})).toEqual([
      "tofu_state_encryption_passphrase",
    ]);
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
