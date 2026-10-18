import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { STACK_MANIFEST } from "homelab/scripts/tofu/tofu-stack-manifest.ts";

const Url = z.string().or(z.null().transform(() => ""));
const Application = z.object({
  id: z.string().min(1),
  description: z.string(),
  custom_install_url: Url,
  interactions_endpoint_url: Url,
  role_connections_verification_url: Url,
  tags: z
    .array(z.string())
    .nullable()
    .transform((value) => (value ?? []).toSorted()),
  bot_public: z.boolean(),
  bot_require_code_grant: z.boolean(),
});
const Resource = z.object({
  address: z.string(),
  mode: z.string(),
  type: z.string(),
  values: z.unknown(),
});
const Plan = z.object({
  resource_changes: z.array(
    z.object({
      address: z.string(),
      mode: z.literal("managed"),
      change: z.object({ before: z.record(z.string(), z.json()) }),
    }),
  ),
  prior_state: z.object({
    values: z.object({
      root_module: z.object({ resources: z.array(Resource) }),
    }),
  }),
});
const discordSecrets = STACK_MANIFEST.discord.secretObject;
if (discordSecrets === undefined)
  throw new Error("Discord owning credential manifest is missing");
const aliases = Object.entries(discordSecrets.entries).map(
  ([name, credential]) => ({ alias: name.replaceAll("-", "_"), credential }),
);

/** Discord resource refresh omits tags; independently read each owning application too. */
export async function readDiscordApplications() {
  const applications: Record<string, unknown> = {};
  for (const { alias, credential } of aliases) {
    const token = Bun.env[credential];
    if (token === undefined || token.length === 0)
      throw new Error("Original Discord inspection credential is missing");
    const response = await fetch(
      "https://discord.com/api/v10/applications/@me",
      {
        headers: { Authorization: `Bot ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(
        "Independent Discord application inspection failed; provider output withheld",
      );
    const raw: unknown = await response.json();
    const value = z.record(z.string(), z.unknown()).parse(raw);
    if (
      Object.hasOwn(value, "tags") &&
      !z.array(z.string()).safeParse(value["tags"]).success
    )
      throw new Error(
        "Independent Discord application tags are invalid; provider values withheld",
      );
    applications[alias] = {
      ...value,
      custom_install_url: value["custom_install_url"] ?? null,
      interactions_endpoint_url: value["interactions_endpoint_url"] ?? null,
      role_connections_verification_url:
        value["role_connections_verification_url"] ?? null,
      tags: value["tags"] ?? null,
    };
  }
  return applications;
}

/** Prove the ORIGINAL TARGET, not unchanged state history or successful acceptance. */
export function requireOriginalDiscordTarget(
  original: unknown,
  current: unknown,
  applications: unknown,
) {
  const parsed = z
    .object({
      original: Plan,
      current: Plan,
      applications: z.record(z.string(), Application),
    })
    .safeParse({ original, current, applications });
  if (!parsed.success)
    throw new Error(
      "Original or fresh Discord baseline is incomplete or unknown; provider values withheld",
    );
  const expected = aliases
    .map(({ alias }) => `discord_application_settings.${alias}`)
    .sort();
  const expectedData = aliases
    .map(({ alias }) => `data.discord_current_application.${alias}`)
    .sort();
  const managed = (plan: z.infer<typeof Plan>) => {
    if (
      canonicalJson(plan.resource_changes.map((row) => row.address).sort()) !==
      canonicalJson(expected)
    )
      throw new Error(
        "Original target requires the complete unique managed Discord inventory",
      );
    return plan.resource_changes
      .map((row) => ({ address: row.address, value: row.change.before }))
      .sort((a, b) => a.address.localeCompare(b.address));
  };
  const data =
    parsed.data.original.prior_state.values.root_module.resources.filter(
      (row) => row.mode === "data",
    );
  if (
    canonicalJson(data.map((row) => row.address).sort()) !==
      canonicalJson(expectedData) ||
    data.some((row) => row.type !== "discord_current_application") ||
    canonicalJson(Object.keys(parsed.data.applications).sort()) !==
      canonicalJson(aliases.map((row) => row.alias).sort())
  )
    throw new Error(
      "Original target requires all six unique computed application baselines",
    );
  const baseline = data
    .map((row) => {
      const value = Application.safeParse(row.values);
      if (!value.success)
        throw new Error(
          "Original computed application baseline is missing or unknown; provider values withheld",
        );
      return {
        alias: row.address.slice("data.discord_current_application.".length),
        value: value.data,
      };
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));
  const before = managed(parsed.data.original);
  const fresh = managed(parsed.data.current);
  if (
    canonicalJson(before) !== canonicalJson(fresh) ||
    baseline.some(
      (row) =>
        canonicalJson(row.value) !==
        canonicalJson(parsed.data.applications[row.alias]),
    )
  )
    throw new Error(
      "Provider target differs from its authenticated original pre-apply baseline",
    );
  return createHash("sha256")
    .update(canonicalJson({ managed: before, applications: baseline }))
    .digest("hex");
}
