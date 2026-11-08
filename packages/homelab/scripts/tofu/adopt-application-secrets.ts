import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { applicationSecrets } from "./application-secrets.ts";
import { assertCleanHandoffSource, targetValue } from "./credential-handoff.ts";
import {
  capturedRead,
  parsePrivateJson,
  readVaultItem,
} from "./secret-read.ts";
import { STATE_CREDENTIALS } from "./tofu-stack-manifest.ts";
import { DELIVERY_PLATFORM_ITEMS } from "#delivery-platform-grants";
import type { OpItem } from "#cdk8s/scripts/onepassword-lib.ts";

const PlanSchema = z.object({
  resource_changes: z
    .array(
      z.object({
        address: z.string(),
        change: z.object({ actions: z.array(z.string()) }),
      }),
    )
    .default([]),
  planned_values: z.object({
    root_module: z.object({
      resources: z.array(
        z.object({
          address: z.string(),
          type: z.literal("random_password"),
          values: z.object({ result: z.string() }),
        }),
      ),
      child_modules: z.array(z.unknown()).optional(),
    }),
  }),
});

/** Inspect private plan JSON in memory; no diagnostic may include its values. */
export function assertAdoptionPlan(
  raw: unknown,
  values: Readonly<Record<string, string>>,
): void {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("Invalid private adoption plan; details withheld.");
  const expected = new Map(
    Object.entries(values).map(([key, value]) => [
      'random_password.credentials["' + key + '"]',
      value,
    ]),
  );
  const { resources, child_modules: children } =
    parsed.data.planned_values.root_module;
  const unique = new Set(resources.map((resource) => resource.address));
  if (
    (children?.length ?? 0) !== 0 ||
    unique.size !== resources.length ||
    resources.length !== expected.size ||
    resources.some(
      (resource) =>
        !expected.has(resource.address) ||
        expected.get(resource.address) !== resource.values.result,
    ) ||
    parsed.data.resource_changes.some(
      (resource) =>
        !expected.has(resource.address) ||
        resource.change.actions.join(",") !== "no-op",
    )
  )
    throw new Error(
      "Adoption requires exact existing values and no creates, replacements or deletions.",
    );
}

function onlyValue(item: OpItem, label: string): string {
  const fields = item.fields?.filter((field) => field.label === label) ?? [];
  const value = fields[0]?.value;
  if (value === undefined || value === "" || fields.length !== 1)
    throw new Error("Required credential field is missing or ambiguous.");
  return value;
}

async function readTargets(): Promise<OpItem[]> {
  const ids = [
    ...new Set(
      Object.values(applicationSecrets.credentials).flatMap((credential) =>
        credential.onepassword_targets.map((target) => target.vault_item_id),
      ),
    ),
  ];
  const items: OpItem[] = [];
  for (let index = 0; index < ids.length; index += 4)
    items.push(
      ...(await Promise.all(
        ids.slice(index, index + 4).map((id) => readVaultItem(id)),
      )),
    );
  return items;
}

function adoptionValues(items: readonly OpItem[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, credential] of Object.entries(
    applicationSecrets.credentials,
  )) {
    const targets = credential.onepassword_targets.map((target) =>
      targetValue(items, target),
    );
    const value = targets[0];
    if (
      value === undefined ||
      credential.revision !== 0 ||
      !/^[\u{20}-\u{7E}]+$/u.test(value) ||
      targets.some((target) => target !== value)
    )
      throw new Error(
        "Adoption requires revision-zero, unambiguous, equal ASCII values.",
      );
    values[key] = value;
  }
  if (Object.keys(values).length === 0)
    throw new Error("No application credentials declared.");
  return values;
}

export async function adoptApplicationSecrets(
  args: readonly string[],
): Promise<void> {
  const [stack, action, expectedHead] = args;
  if (
    stack !== "application-secrets" ||
    action !== "adopt" ||
    args.length !== 3
  )
    throw new Error(
      "Usage: tofu-stack.ts application-secrets adopt EXPECTED_HEAD",
    );
  if (
    Bun.env["CI"] !== undefined &&
    !["", "0", "false"].includes(Bun.env["CI"])
  )
    throw new Error("Application secret adoption is operator-only.");
  const sourceOutput = await capturedRead(
    ["git", "rev-parse", "HEAD"],
    "adoption source revision",
  );
  const head = sourceOutput.trim();
  if (expectedHead !== head || !/^[a-f0-9]{40}$/u.test(expectedHead))
    throw new Error("Adoption requires the exact current source revision.");
  await assertCleanHandoffSource();
  const items = await readTargets();
  const values = adoptionValues(items);
  const bootstrap = await readVaultItem("application-secrets-tofu-credentials");
  const state = await readVaultItem(
    DELIVERY_PLATFORM_ITEMS["ci-seaweedfs-credentials"].itemId,
  );
  const env: Record<string, string | undefined> = {};
  for (const name of [
    "PATH",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    if (Bun.env[name] !== undefined) env[name] = Bun.env[name];
  for (const { source, target } of STATE_CREDENTIALS)
    env[target] = onlyValue(state, source);
  env["TF_VAR_tofu_state_encryption_passphrase"] = onlyValue(
    bootstrap,
    "TOFU_STATE_ENCRYPTION_PASSPHRASE",
  );
  env["TF_VAR_adoption_lengths"] = JSON.stringify(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.length]),
    ),
  );
  env["TF_VAR_adoption_keys"] = JSON.stringify(Object.keys(values));
  env["TF_VAR_adoption_values"] = JSON.stringify(values);
  const directory = await mkdtemp(
    path.join(tmpdir(), "application-secret-adoption-"),
  );
  env["TF_DATA_DIR"] = path.join(directory, "providers");
  const plan = path.join(directory, "adoption.plan");
  const command = (commandArgs: string[]) =>
    capturedRead(
      [
        "tofu",
        "-chdir=packages/homelab/src/tofu/application-secrets",
        ...commandArgs,
      ],
      "protected application-secret " + (commandArgs[0] ?? "operation"),
      env,
    );
  const inspect = async (file: string) => {
    parsePrivateJson(
      await Bun.file(file).text(),
      z.object({ encrypted_data: z.string().min(1) }),
    );
    assertAdoptionPlan(
      parsePrivateJson(await command(["show", "-json", file]), z.unknown()),
      values,
    );
  };
  try {
    await command(["init", "-input=false", "-lockfile=readonly"]);
    await command(["plan", "-input=false", "-out=" + plan]);
    await inspect(plan);
    await assertCleanHandoffSource();
    const recheckedSource = await capturedRead(
      ["git", "rev-parse", "HEAD"],
      "adoption source recheck",
    );
    if (recheckedSource.trim() !== head)
      throw new Error("Adoption source changed after planning.");
    const fresh = await readTargets();
    const freshValues = adoptionValues(fresh);
    const freshBootstrap = await readVaultItem(bootstrap.id);
    if (
      freshBootstrap.version !== bootstrap.version ||
      onlyValue(freshBootstrap, "TOFU_STATE_ENCRYPTION_PASSPHRASE") !==
        env["TF_VAR_tofu_state_encryption_passphrase"]
    )
      throw new Error(
        "Encryption credential changed after planning; replan without applying.",
      );
    if (
      items.some(
        (item) =>
          fresh.find((candidate) => candidate.id === item.id)?.version !==
          item.version,
      ) ||
      Object.keys(values).some((key) => values[key] !== freshValues[key])
    )
      throw new Error(
        "Credential targets changed after planning; replan without applying.",
      );
    await command(["apply", "-input=false", plan]);
    env["TF_VAR_adoption_keys"] = "[]";
    env["TF_VAR_adoption_values"] = "{}";
    const verification = path.join(directory, "verification.plan");
    await command([
      "plan",
      "-input=false",
      "-detailed-exitcode",
      "-out=" + verification,
    ]);
    await inspect(verification);
    const outputs = parsePrivateJson(
      await command(["output", "-json", "application_secret_handoffs"]),
      z.record(
        z.string(),
        z.object({ value: z.string(), revision: z.literal(0) }),
      ),
    );
    const finalValues = adoptionValues(await readTargets());
    if (
      Object.keys(outputs).length !== Object.keys(values).length ||
      Object.keys(values).some(
        (key) =>
          outputs[key]?.value !== values[key] ||
          finalValues[key] !== values[key],
      )
    )
      throw new Error(
        "Adopted state or current vault values differ; inspect before retrying.",
      );
    console.log(
      JSON.stringify({
        source_revision: head,
        adopted_units: Object.keys(values).toSorted(),
        values_preserved: true,
        second_plan: "no changes",
        vault_writes: false,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
