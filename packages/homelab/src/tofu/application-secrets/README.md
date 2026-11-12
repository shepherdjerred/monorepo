# Application credential adoption

This stack declares local application credentials in `desired-state.json`.
It has no 1Password provider or CI credential grant. The stack wrapper accepts
`validate` and an operator-only `adopt EXPECTED_HEAD` command; general plan,
apply and rotation remain disabled.

The configuration is `main.tf.json`, synthesized from
`packages/homelab-cdktn/src/stacks/application-secrets.ts`; see
`packages/homelab-cdktn/README.md`. The adoption runner accepts changes only
at `random_password.credentials["<key>"]`, so that resource and its `import`
block keep those addresses.

The catalog has one rotation unit per credential and environment. A unit may
have multiple fields only when they represent the same account, permission
boundary and rotation owner. The preparation tool checks equality in memory;
that comparison alone does not establish those properties.

Revision zero is an adoption profile. `adoption_lengths` records inspected
lengths; `adoption_keys` selects declarative imports; sensitive
`adoption_values` supplies their existing values through process environment.
The profile matches the pinned random provider's imported defaults without
`ignore_changes`. It requires an import plan with zero replacements. The
adoption inputs must remain in memory. State and saved plans enforce AES-GCM
encryption from their first write, with a unique stack passphrase.

OpenTofu rejects sensitive import IDs. The import expression must therefore
remove that marker for the provider's password-as-ID interface. The operator
runner captures both output streams and suppresses private diagnostics. It
requires clean owning source at the exact supplied revision, verifies every
planned result against the existing value, and refuses creation, replacement
or destruction. It rechecks item versions before applying the encrypted saved
plan, then requires an unchanged second plan and matching vault values.

After adoption, a separately reviewed revision increment replaces that unit
with 64 lowercase alphanumeric characters, including a letter and a digit.
There is no automatic rotation. Keep revision-zero lengths available until
the respective units rotate. Provider import compatibility is verified with
short and long ASCII values; other encodings require a separate review.

Contributor commands from the repository root:

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts application-secrets validate
bun packages/homelab/scripts/tofu/tofu-stack.ts application-secrets adopt EXPECTED_HEAD
bun run --cwd packages/homelab test:secrets:tofu
bun packages/homelab/scripts/tofu/credential-handoff.ts application-secrets preview
bun run --cwd packages/homelab/src/cdk8s audit:1password --live
```

`preview` reads the vault and prints only target metadata, item versions,
adoption compatibility and prerequisites. `verify <expected-head>` compares
an existing sensitive handoff output to the declared fields. Before reading
credentials, it requires clean owning source, package import maps, the
dependency lockfile, and Bun/TypeScript resolution configuration. It cannot
establish the source revision of live state. It
reports that gap and still requires consumer probes before revocation.
Neither command writes, imports, applies, archives or deletes anything.

Adoption reads the unique `TOFU_STATE_ENCRYPTION_PASSPHRASE` field in
`application-secrets-tofu-credentials` and the existing provider state
credentials through the service-account wrapper. Preserve that passphrase in
1Password for recovery. Importing establishes OpenTofu ownership while keeping
the current value and its original provenance.

Platform handoffs from OpenAI and Cloudflare can declare only a field label.
The verifier accepts a sectioned field only when that label identifies exactly
one physical field in the item. Duplicate labels remain unresolved even when
their values match. Application targets declare field IDs and use exact section
matching; they never fall back to a label after a physical selector mismatch.

The offline `check:1password` gate checks application targets against the
committed vault snapshot. It requires the label, field ID and section ID to
identify the same physical field, including whether the field is top-level.
Refresh the snapshot after changing those selectors. The snapshot stores only
hashed metadata and field emptiness, never credential values or fingerprints.

The vault audit shares synthesis and field transforms with the structural
checker, evaluates CI grants and toolkit credential locators, scans tracked
references including dotfiles, and optionally inspects live workload bindings.
With no `--vault`, the audit selects the Kubernetes vault. Explicit flags replace
that default: repeat `--vault ID` for every vault to inspect, including Kubernetes
when required. References outside that selection remain coverage gaps.
The audit excludes empty values and identifiers
from exact credential comparison, including credential-shaped JSON leaves.
Whole-secret consumers, ambiguous references, provider-owned items,
attachments, recovery material and consumer coverage gaps prevent automatic
cleanup. An unreferenced item is a review candidate, never proof of safe
archiving. Audit output belongs outside the repository and contains no values
or credential fingerprints.

The audit's `field_mapping` inventories every physical field, including blank
template fields and configuration. Each unambiguous field has one canonical
`op://` reference using vault, item, section and field IDs. Observed title,
label and Kubernetes key selectors resolve to that reference; JSON pointers
remain separate selectors on the parent field. Whole-item consumers are
recorded separately because their field usage is opaque. URL and attachment
metadata is also inventoried, without reading attachment contents.

Duplicate field IDs, case-insensitive reference collisions and operator key
collisions are explicit blockers. A canonical selector must resolve to its own
field; field and section labels that shadow IDs are reported as `selector_alias`
collisions. Rotation ownership compares IDs case-insensitively while keeping
JSON pointers case-sensitive. The tool never assigns an ambiguous field
a canonical reference or selects a survivor based on equal values. Physically
duplicated credentials remain review candidates until their ownership and
consumer boundaries are established. The mapping is metadata, not a vault
deduplication or an authorization to change live items.

`test:secrets:tofu` copies the committed `main.tf.json`, less its remote
backend, into a disposable local backend with synthetic values. It verifies import preservation, an unchanged second plan,
encrypted state and isolation of an explicit rotation. It does not use live
1Password or the remote state backend.
