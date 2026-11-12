import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
import { SYNTHESIZED_STACKS } from "#src/app.ts";
import { TAILNET_POLICY } from "#src/stacks/tailscale-policy.ts";
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
  data: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
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

describe("tailscale", () => {
  test("keeps the one policy resource and encodes the policy with its keys untouched", async () => {
    const tailscale = await configuration("tailscale");
    expect(addresses(tailscale.resource)).toEqual(["tailscale_acl.homelab"]);
    expect(tailscale.resource["tailscale_acl"]?.["homelab"]).toEqual({
      acl: "${jsonencode(local.policy)}",
      overwrite_existing_content: true,
    });
    // Policy fields and tags are data: `tagOwners` must not become
    // `tag_owners`, and no rule may be dropped or reordered.
    expect(tailscale.locals).toEqual({ policy: TAILNET_POLICY });
    // Derived from the platform model's tags and tailnet services: a model
    // edit that changes who may assign a tag shows here.
    expect(TAILNET_POLICY.tagOwners).toEqual({
      "tag:ci": ["autogroup:admin"],
      "tag:delivery": ["autogroup:admin", "tag:k8s-operator"],
      "tag:iot": ["autogroup:admin"],
      "tag:k8s": ["tag:k8s-operator"],
      "tag:k8s-operator": ["autogroup:admin"],
      "tag:monitoring": ["autogroup:admin"],
      "tag:server": ["autogroup:admin"],
    });
    expect(Object.keys(TAILNET_POLICY).toSorted()).toEqual([
      "acls",
      "autoApprovers",
      "groups",
      "ssh",
      "tagOwners",
      "tests",
    ]);
    expect(tailscale.variable).toEqual({
      tailscale_tailnet: {
        default: "-",
        description:
          "Tailscale tailnet (organization). '-' resolves to the OAuth client's default tailnet.",
        type: "string",
      },
    });
    // The lock file records this constraint; a different one rewrites it.
    expect(tailscale.terraform.required_providers["tailscale"]).toEqual({
      source: "tailscale/tailscale",
      version: "~> 0.17",
    });
    expect(tailscale.import).toBeUndefined();
    expect(tailscale.moved).toBeUndefined();
    expect(tailscale.removed).toBeUndefined();
    expect(tailscale.terraform.encryption).toBeUndefined();
  });

  test("the owner keeps full access and the cluster keeps its state backend path", () => {
    // Losing either cuts off the homelab; the policy's own `tests` guard the
    // second on apply, this guards both before a plan exists.
    expect(TAILNET_POLICY.acls).toContainEqual({
      action: "accept",
      src: ["autogroup:admin"],
      dst: ["*:*"],
    });
    expect(TAILNET_POLICY.acls).toContainEqual({
      action: "accept",
      src: ["tag:k8s"],
      dst: ["tag:k8s:443"],
    });
  });
});

describe("arr", () => {
  test("keeps every *arr address, the ignored indexer fields and sensitive inputs", async () => {
    const arr = await configuration("arr");
    expect(addresses(arr.resource)).toEqual([
      "prowlarr_application.radarr",
      "prowlarr_application.sonarr",
      "prowlarr_download_client.qbittorrent",
      "prowlarr_indexer.animez",
      "prowlarr_indexer.avistaz",
      "prowlarr_indexer.knaben",
      "prowlarr_indexer.magnetdownload",
      "prowlarr_indexer.privatehd",
      "prowlarr_indexer.the_pirate_bay",
      "radarr_download_client.qbittorrent",
      "radarr_root_folder.movies",
      "sonarr_download_client.qbittorrent",
      "sonarr_root_folder.tv",
    ]);
    expect(arr.import).toBeUndefined();
    expect(arr.moved).toBeUndefined();
    expect(arr.removed).toBeUndefined();
    expect(arr.terraform.encryption).toBeUndefined();
    expect(arr.terraform.required_providers).toEqual({
      prowlarr: { source: "devopsarr/prowlarr", version: "~> 3.0" },
      radarr: { source: "devopsarr/radarr", version: "~> 2.0" },
      sonarr: { source: "devopsarr/sonarr", version: "~> 3.0" },
    });

    // Every input is sensitive, and the local the resources index is built
    // only from those inputs, so each value read through it stays sensitive.
    const variables = z
      .record(z.string(), z.looseObject({ sensitive: z.literal(true) }))
      .parse(arr.variable);
    expect(Object.keys(variables)).toHaveLength(10);
    expect(arr.locals?.["arr_api_keys"]).toEqual({
      radarr: "${var.radarr_api_key}",
      sonarr: "${var.sonarr_api_key}",
      prowlarr: "${var.prowlarr_api_key}",
      qbittorrent: "${var.qbittorrent_password}",
      privatehd_password: "${var.privatehd_password}",
      privatehd_pid: "${var.privatehd_pid}",
      avistaz_password: "${var.avistaz_password}",
      avistaz_pid: "${var.avistaz_pid}",
      animez_password: "${var.animez_password}",
      animez_pid: "${var.animez_pid}",
    });

    const indexers = arr.resource["prowlarr_indexer"] ?? {};
    // Prowlarr owns the public indexers' fields; the credentialed ones are
    // managed, with their secrets in `sensitive_value` in declared order.
    for (const name of ["knaben", "magnetdownload", "the_pirate_bay"]) {
      expect(indexers[name], name).toMatchObject({
        lifecycle: { ignore_changes: ["fields"] },
      });
    }
    for (const name of ["privatehd", "avistaz", "animez"]) {
      expect(indexers[name], name).not.toHaveProperty("lifecycle");
      expect(indexers[name], name).toMatchObject({
        fields: [
          { name: "freeleechOnly", bool_value: false },
          { name: "torrentBaseSettings.preferMagnetUrl", bool_value: false },
          { name: "baseSettings.limitsUnit", number_value: 0 },
          { name: "baseUrl" },
          {
            name: "password",
            sensitive_value: `\${local.arr_api_keys["${name}_password"]}`,
          },
          {
            name: "pid",
            sensitive_value: `\${local.arr_api_keys["${name}_pid"]}`,
          },
          { name: "torrentBaseSettings.seedRatio", number_value: 3 },
          { name: "username" },
        ],
      });
    }
    expect(
      arr.resource["prowlarr_download_client"]?.["qbittorrent"],
    ).toMatchObject({
      categories: [],
      password: '${local.arr_api_keys["qbittorrent"]}',
    });
  });
});

describe("dockerhub-tokens", () => {
  test("keeps one protected token per purpose, its account reads and the handoff output", async () => {
    const tokens = await configuration("dockerhub-tokens");
    expect(addresses(tokens.resource)).toEqual([
      "docker_access_token.automation",
    ]);
    expect(
      tokens.resource["docker_access_token"]?.["automation"],
    ).toMatchObject({
      for_each: {
        management: { scopes: ["repo:read", "repo:write", "repo:admin"] },
        publisher: { scopes: ["repo:read", "repo:write"] },
        reader: { scopes: ["repo:read"] },
        renovate: { scopes: ["repo:read"] },
      },
      token_label: "homelab-${each.key}",
      scopes: "${each.value.scopes}",
      lifecycle: { prevent_destroy: true },
    });
    expect(tokens.data).toEqual({
      docker_access_tokens: { account: {} },
      docker_login: {
        operator: { depends_on: ["data.docker_access_tokens.account"] },
      },
    });
    expect(tokens.output).toEqual({
      credentials: {
        description:
          "In-memory handoff to separate 1Password items; never print or save the decrypted output.",
        sensitive: true,
        value:
          "${{ for purpose, token in docker_access_token.automation : purpose => { username = data.docker_login.operator.username, token = token.token, uuid = token.uuid } }}",
      },
    });
    expect(tokens.import).toBeUndefined();
    expect(tokens.terraform.encryption).toMatchObject({
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
    expect(Object.keys(tokens.variable ?? {})).toEqual([
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
