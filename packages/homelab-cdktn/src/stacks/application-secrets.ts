import type { Construct } from "constructs";
import {
  TerraformIterator,
  TerraformLocal,
  TerraformOutput,
  TerraformVariable,
  Token,
} from "cdktn";
import { Password } from "#generated/providers/random/password/index.ts";
import { RandomProvider } from "#generated/providers/random/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";

const ADOPTING = "each.value.revision == 0";

/**
 * Local application credentials declared in the stack's
 * `desired-state.json`, adopted from their existing values. Validate-only:
 * the only live action is the operator's `adopt`, which plans and applies
 * through `scripts/tofu/adopt-application-secrets.ts`. See
 * `src/tofu/application-secrets/README.md`.
 */
export class ApplicationSecretsStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "application-secrets", {
      requiredVersion: ">= 1.12.0",
      providerConstraints: { random: "3.9.1" },
    });

    encryptStateAndPlans(this, {
      description:
        "Unique application-secrets state passphrase supplied by the operator.",
      errorMessage:
        "State encryption requires a passphrase of at least 16 characters.",
    });

    new TerraformVariable(this, "adoption_lengths", {
      description:
        "Nonsecret lengths inspected during adoption; retain for revision zero.",
      type: "map(number)",
      default: {},
    });
    new TerraformVariable(this, "adoption_keys", {
      description:
        "Explicit nonsecret keys to import, supplied only during initial adoption.",
      type: "set(string)",
      default: [],
    });
    new TerraformVariable(this, "adoption_values", {
      description:
        "Existing values passed in memory by the operator; never in argv or files.",
      type: "map(string)",
      sensitive: true,
      default: {},
    });

    new RandomProvider(this, "random");

    // The catalog is read at plan time, not imported here: the adoption
    // fixture test plans this configuration against a catalog of its own.
    const credentials = new TerraformLocal(
      this,
      "credentials",
      '${jsondecode(file("${path.module}/desired-state.json")).credentials}',
    );

    // Import defaults must match random_password's imported state. Revision
    // zero preserves any existing character recipe; later revisions
    // explicitly rotate. Each expression is the HCL one, passed whole.
    new Password(this, "random_password_credentials", {
      forEach: TerraformIterator.fromMap(credentials.asAnyMap),
      length: Token.asNumber(
        `\${${ADOPTING} ? lookup(var.adoption_lengths, each.key, 64) : 64}`,
      ),
      upper: Token.asAny(`\${${ADOPTING}}`),
      lower: true,
      numeric: true,
      special: Token.asAny(`\${${ADOPTING}}`),
      minLower: Token.asNumber(`\${${ADOPTING} ? 0 : 1}`),
      minNumeric: Token.asNumber(`\${${ADOPTING} ? 0 : 1}`),
      keepers: Token.asStringMap(
        `\${${ADOPTING} ? null : { revision = tostring(each.value.revision) }}`,
      ),
      lifecycle: {
        precondition: [
          {
            condition:
              "${each.value.revision > 0 || contains(keys(var.adoption_lengths), each.key)}",
            errorMessage:
              "Revision zero requires verified adoption lengths; do not generate replacements during adoption.",
          },
        ],
      },
    }).overrideLogicalId("credentials");

    // `adopt-application-secrets.ts` expects exactly these addresses. An
    // `import` block with `for_each` has no cdktn builder, so it is a stack
    // override. OpenTofu rejects sensitive import IDs. The operator adoption
    // path captures all diagnostics and uses encrypted plans. Never run this
    // import with inherited stdout.
    this.addOverride("import", [
      {
        for_each: "${var.adoption_keys}",
        to: "random_password.credentials[each.key]",
        id: "${nonsensitive(var.adoption_values[each.key])}",
      },
    ]);

    new TerraformOutput(this, "application_secret_handoffs", {
      description:
        "Sensitive operator handoffs; the stack has no 1Password write provider.",
      sensitive: true,
      value:
        "${{ for key, credential in local.credentials : key => { value = random_password.credentials[key].result, revision = credential.revision, onepassword_targets = credential.onepassword_targets } }}",
    });
  }
}
