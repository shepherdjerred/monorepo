import { Fn, Op, TerraformVariable } from "cdktn";
import type { TerraformStack } from "cdktn";

/** The passphrase variable most encrypted stacks declare. */
export const STATE_PASSPHRASE_VARIABLE = "tofu_state_encryption_passphrase";

/** The shortest passphrase every encrypted stack's validation accepts. */
export const MINIMUM_PASSPHRASE_LENGTH = 16;

export type StateEncryptionOptions = {
  /** The passphrase variable's name; {@link STATE_PASSPHRASE_VARIABLE} unless the stack declares another. */
  readonly variable?: string;
  /** The variable's description, as the stack declares it. */
  readonly description: string;
  /** The message of the variable's minimum-length validation. */
  readonly errorMessage: string;
  /**
   * Names of the `pbkdf2` key provider and the `aes_gcm` method. Encrypted
   * state records the key provider's address, so an existing stack keeps the
   * names its state was written with.
   */
  readonly keyProvider?: string;
  readonly method?: string;
};

/**
 * OpenTofu client-side encryption of state and saved plans, enforced from the
 * first write: a pbkdf2 key from a passphrase variable, used by one
 * `aes_gcm` method for both.
 *
 * cdktn has no construct for the `encryption` block, so it is an override on
 * the stack's `terraform` block. In JSON syntax a `method` reference is the
 * bare address, not an interpolation. `tofu validate -backend=false` does not
 * evaluate the block; `encryption.test.ts` runs it through a real encrypted
 * plan instead.
 */
export function encryptStateAndPlans(
  stack: TerraformStack,
  options: StateEncryptionOptions,
): TerraformVariable {
  const keyProvider = options.keyProvider ?? "state";
  const methodName = options.method ?? "encrypted";
  const passphrase = new TerraformVariable(
    stack,
    options.variable ?? STATE_PASSPHRASE_VARIABLE,
    { description: options.description, type: "string", sensitive: true },
  );
  passphrase.addValidation({
    condition: Op.gte(
      Fn.lengthOf(passphrase.stringValue),
      MINIMUM_PASSPHRASE_LENGTH,
    ),
    errorMessage: options.errorMessage,
  });
  const method = `method.aes_gcm.${methodName}`;
  stack.addOverride("terraform.encryption", {
    key_provider: {
      pbkdf2: { [keyProvider]: { passphrase: passphrase.stringValue } },
    },
    method: {
      aes_gcm: {
        [methodName]: { keys: `\${key_provider.pbkdf2.${keyProvider}}` },
      },
    },
    state: { method, enforced: true },
    plan: { method, enforced: true },
  });
  return passphrase;
}
