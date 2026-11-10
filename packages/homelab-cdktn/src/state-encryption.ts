import { Fn, Op, TerraformVariable } from "cdktn";
import type { TerraformStack } from "cdktn";

/** The variable every encrypted stack reads its state passphrase from. */
export const STATE_ENCRYPTION_PASSPHRASE_VARIABLE =
  "tofu_state_encryption_passphrase";

/**
 * OpenTofu client-side state and plan encryption: a PBKDF2 key from the
 * stack's passphrase variable, AES-GCM, enforced for both state and plans.
 *
 * cdktn has no construct for the `encryption` block, so it is an override on
 * the `terraform` block. In JSON syntax `method` is the bare static address
 * `method.aes_gcm.encrypted`, not an interpolation. `tofu validate
 * -backend=false` never evaluates this block, so `state-encryption.test.ts`
 * runs it through a throwaway encrypted plan.
 */
export function encryptState(stack: TerraformStack): TerraformVariable {
  const passphrase = new TerraformVariable(
    stack,
    STATE_ENCRYPTION_PASSPHRASE_VARIABLE,
    {
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      type: "string",
      sensitive: true,
    },
  );
  passphrase.addValidation({
    condition: Op.gte(Fn.lengthOf(passphrase.stringValue), 16),
    errorMessage:
      "The OpenTofu state encryption passphrase must be at least 16 characters.",
  });
  const method = "method.aes_gcm.encrypted";
  stack.addOverride("terraform.encryption", {
    key_provider: {
      pbkdf2: {
        state: {
          passphrase: `\${var.${STATE_ENCRYPTION_PASSPHRASE_VARIABLE}}`,
        },
      },
    },
    method: {
      aes_gcm: { encrypted: { keys: "${key_provider.pbkdf2.state}" } },
    },
    state: { method, enforced: true },
    plan: { method, enforced: true },
  });
  return passphrase;
}
