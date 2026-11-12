import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { enforcedEncryption, synthesizeStack } from "#src/testing.ts";

const EncryptedSchema = z.looseObject({
  terraform: z.looseObject({ encryption: z.unknown() }),
  variable: z.record(z.string(), z.unknown()),
});

async function encrypted(
  options: Parameters<typeof encryptStateAndPlans>[1],
): Promise<z.infer<typeof EncryptedSchema>> {
  return EncryptedSchema.parse(
    await synthesizeStack((stack) => {
      encryptStateAndPlans(stack, options);
    }),
  );
}

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

describe("state and plan encryption", () => {
  test("declares the passphrase variable and the enforced block the HCL stacks write", async () => {
    const { terraform, variable } = await encrypted({
      description: "Passphrase encrypting Docker Hub state and plans.",
      errorMessage:
        "The state encryption passphrase must contain at least 16 characters.",
    });
    expect(variable).toEqual({
      tofu_state_encryption_passphrase: {
        description: "Passphrase encrypting Docker Hub state and plans.",
        type: "string",
        sensitive: true,
        validation: [
          {
            condition:
              "${(length(var.tofu_state_encryption_passphrase) >= 16)}",
            error_message:
              "The state encryption passphrase must contain at least 16 characters.",
          },
        ],
      },
    });
    expect(terraform.encryption).toEqual(enforcedEncryption());
  });

  test("keeps a stack's own variable, key provider and method names", async () => {
    const { terraform, variable } = await encrypted({
      variable: "state_passphrase",
      keyProvider: "posthog",
      method: "posthog",
      description:
        "Passphrase used to encrypt this stack's state and plan data.",
      errorMessage:
        "The PostHog state passphrase must contain at least 16 characters.",
    });
    expect(Object.keys(variable)).toEqual(["state_passphrase"]);
    expect(terraform.encryption).toEqual(
      enforcedEncryption({
        variable: "state_passphrase",
        keyProvider: "posthog",
        method: "posthog",
      }),
    );
  });

  /**
   * `tofu validate -backend=false` does not evaluate the `encryption` block,
   * so a malformed override passes validation and fails only when state or a
   * plan is read. This runs the block for real: a throwaway local plan must
   * encrypt, and decrypt again only with the same passphrase.
   */
  test("OpenTofu encrypts a plan with the block and decrypts it only with the same passphrase", async () => {
    const passphrase = "fixture-only-encryption-passphrase";
    const { terraform, variable } = await encrypted({
      description: "Fixture passphrase.",
      errorMessage: "Fixture passphrases have at least 16 characters.",
    });
    const directory = await mkdtemp(path.join(tmpdir(), "cdktn-encryption-"));
    try {
      // Only the encryption block and its variable, on a local backend with
      // a built-in resource: no provider download, no remote state.
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
});
