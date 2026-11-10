import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { encryptState } from "#src/state-encryption.ts";
import { synthesizeStack } from "#src/testing.ts";

const EncryptedSchema = z.looseObject({
  terraform: z.looseObject({ encryption: z.unknown() }),
  variable: z.record(z.string(), z.unknown()),
});

async function tofu(
  directory: string,
  args: string[],
  passphrase: string,
): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn(["tofu", `-chdir=${directory}`, ...args], {
    env: {
      PATH: Bun.env["PATH"],
      HOME: Bun.env["HOME"],
      // CI's mise shims resolve installed tools under this bootstrap path.
      MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
      TF_VAR_tofu_state_encryption_passphrase: passphrase,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stdout + stderr };
}

/**
 * `tofu validate -backend=false` does not evaluate the `encryption` block, so
 * a malformed override passes validation and fails only when state or a plan
 * is read. This runs the block for real: a throwaway local plan must encrypt,
 * and decrypt again only with the same passphrase.
 */
test("OpenTofu encrypts and decrypts a plan with the synthesized encryption block", async () => {
  const passphrase = "fixture-only-encryption-passphrase";
  const { terraform, variable } = EncryptedSchema.parse(
    await synthesizeStack((stack) => {
      encryptState(stack);
    }),
  );
  expect(Object.keys(variable)).toEqual(["tofu_state_encryption_passphrase"]);
  const directory = await mkdtemp(path.join(tmpdir(), "cdktn-encryption-"));
  try {
    // Only the encryption block and its variable, on a local backend with a
    // built-in resource: no provider download, no remote state.
    await Bun.write(
      path.join(directory, "main.tf.json"),
      JSON.stringify({
        terraform: { encryption: terraform.encryption },
        variable,
        resource: { terraform_data: { probe: {} } },
      }),
    );
    const plan = path.join(directory, "plan.tfplan");
    const init = await tofu(directory, ["init", "-input=false"], passphrase);
    expect(init.exitCode, init.output).toBe(0);
    const planned = await tofu(
      directory,
      ["plan", "-input=false", `-out=${plan}`],
      passphrase,
    );
    expect(planned.exitCode, planned.output).toBe(0);
    expect(await Bun.file(plan).text()).toContain("encrypted_data");
    const shown = await tofu(directory, ["show", plan], passphrase);
    expect(shown.exitCode, shown.output).toBe(0);
    expect(shown.output).toContain("terraform_data.probe");
    const refused = await tofu(
      directory,
      ["show", plan],
      "a-different-fixture-passphrase",
    );
    expect(refused.exitCode).not.toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
