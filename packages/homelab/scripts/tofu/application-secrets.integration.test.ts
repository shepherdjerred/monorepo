import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { capturedRead, parsePrivateJson } from "./secret-read.ts";
import { assertAdoptionPlan } from "./adopt-application-secrets.ts";

const stackDir = new URL("../../src/tofu/application-secrets/", import.meta.url)
  .pathname;
const EnforcedSchema = z.looseObject({ enforced: z.boolean() });
const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    backend: z.record(z.string(), z.unknown()),
    encryption: z.looseObject({ state: EnforcedSchema, plan: EnforcedSchema }),
  }),
});
const PlanSchema = z.object({
  resource_changes: z.array(
    z.object({
      address: z.string(),
      change: z.object({ actions: z.array(z.string()) }),
    }),
  ),
});

test("encrypted fixture adoption preserves values and only an explicit revision replaces its field", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "application-secret-fixture-"),
  );
  const adopted = {
    first: "fixture-first-unchanged-123".repeat(5),
    second: "fixture-second-unchanged-456",
  };
  // Test-only synthetic values. No real vault or remote backend is used.
  const env = {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    // CI's mise shims resolve installed tools under this nonsecret bootstrap path.
    MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
    TF_VAR_tofu_state_encryption_passphrase:
      "fixture-only-encryption-passphrase",
    TF_VAR_adoption_lengths: JSON.stringify(
      Object.fromEntries(
        Object.entries(adopted).map(([key, value]) => [key, value.length]),
      ),
    ),
    TF_VAR_adoption_keys: JSON.stringify(Object.keys(adopted)),
    TF_VAR_adoption_values: JSON.stringify(adopted),
  };
  const command = (args: string[]) =>
    capturedRead(
      ["tofu", `-chdir=${fixtureRoot}`, ...args],
      "local synthetic OpenTofu fixture",
      env,
    );
  try {
    // The synthesized configuration exactly as committed, less its remote
    // backend: the fixture keeps encrypted state on local disk.
    const { terraform, ...configuration } = ConfigurationSchema.parse(
      await Bun.file(path.join(stackDir, "main.tf.json")).json(),
    );
    const { backend, ...settings } = terraform;
    expect(Object.keys(backend)).toEqual(["s3"]);
    expect(settings.encryption.state.enforced).toBe(true);
    expect(settings.encryption.plan.enforced).toBe(true);
    await Bun.write(
      path.join(fixtureRoot, "main.tf.json"),
      JSON.stringify({ ...configuration, terraform: settings }),
    );
    await Bun.write(
      path.join(fixtureRoot, ".terraform.lock.hcl"),
      await Bun.file(path.join(stackDir, ".terraform.lock.hcl")).text(),
    );
    const catalog = {
      credentials: {
        first: { revision: 0, onepassword_targets: [] },
        second: { revision: 0, onepassword_targets: [] },
      },
    };
    await Bun.write(
      path.join(fixtureRoot, "desired-state.json"),
      JSON.stringify(catalog),
    );
    await command([
      "init",
      "-backend=false",
      "-input=false",
      "-lockfile=readonly",
    ]);
    await command(["plan", "-input=false", "-out=adoption.plan"]);
    const savedPlan = await Bun.file(
      path.join(fixtureRoot, "adoption.plan"),
    ).text();
    expect(savedPlan).not.toContain(adopted.first);
    expect(savedPlan).toContain("encrypted_data");
    const rawPlan = parsePrivateJson(
      await command(["show", "-json", "adoption.plan"]),
      z.unknown(),
    );
    assertAdoptionPlan(rawPlan, adopted);
    const initial = PlanSchema.parse(rawPlan);
    expect(
      initial.resource_changes.every(
        (change) => change.change.actions.join(",") === "no-op",
      ),
    ).toBe(true);
    await command(["apply", "-input=false", "adoption.plan"]);
    const state = await Bun.file(
      path.join(fixtureRoot, "terraform.tfstate"),
    ).text();
    expect(state).not.toContain(adopted.first);
    expect(state).not.toContain(adopted.second);
    expect(state).toContain("encrypted_data");
    const outputs = parsePrivateJson(
      await command(["output", "-json", "application_secret_handoffs"]),
      z.record(z.string(), z.object({ value: z.string() })),
    );
    // Compare booleans so failed assertions cannot print sensitive outputs.
    expect(outputs["first"]?.value === adopted.first).toBe(true);
    expect(outputs["second"]?.value === adopted.second).toBe(true);
    env.TF_VAR_adoption_keys = "[]";
    env.TF_VAR_adoption_values = "{}";
    await command(["plan", "-input=false", "-detailed-exitcode"]);
    catalog.credentials.first.revision = 1;
    await Bun.write(
      path.join(fixtureRoot, "desired-state.json"),
      JSON.stringify(catalog),
    );
    await command(["plan", "-input=false", "-out=rotation.plan"]);
    const rotation = parsePrivateJson(
      await command(["show", "-json", "rotation.plan"]),
      PlanSchema,
    );
    const changes = rotation.resource_changes.filter(
      (change) => change.change.actions.join(",") !== "no-op",
    );
    expect(changes.map((change) => change.address)).toEqual([
      'random_password.credentials["first"]',
    ]);
    expect(changes[0]?.change.actions).toEqual(["delete", "create"]);
    await command(["apply", "-input=false", "rotation.plan"]);
    const rotated = parsePrivateJson(
      await command(["output", "-json", "application_secret_handoffs"]),
      z.record(z.string(), z.object({ value: z.string() })),
    );
    expect(
      rotated["first"]?.value !== adopted.first &&
        /^[a-z0-9]{64}$/u.test(rotated["first"]?.value ?? ""),
    ).toBe(true);
    expect(rotated["second"]?.value === adopted.second).toBe(true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}, 90_000);
