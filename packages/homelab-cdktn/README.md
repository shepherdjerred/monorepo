# @homelab/cdktn

The CDK Terrain (cdktn) application that synthesizes every OpenTofu stack.
Each stack is a TypeScript class in `src/stacks/<stack>.ts`, or in
`src/stacks/<stack>/index.ts` when it is split across files; `bun run synth`
writes its configuration to `packages/homelab/src/tofu/<stack>/main.tf.json`,
which is committed next to the stack's lock file.

OpenTofu stays the engine. Nothing here plans or applies: the stack runner
(`packages/homelab/scripts/tofu/tofu-stack.ts`) and Delivery read the committed
JSON, and refuse a stack directory that lacks it or holds a `.tf` file.
`packages/homelab/src/tofu/README.md` describes the stacks, their credentials
and how they are run.

## Commands

```bash
bunx turbo run generate --filter=@homelab/cdktn    # provider bindings (needs tofu, Node, Go, registry access)
bun run --cwd packages/homelab-cdktn synth         # rewrite every main.tf.json
bunx turbo run build typecheck test lint --filter=@homelab/cdktn
bun run --cwd packages/homelab-cdktn providers:refresh   # apply provider pin changes
```

`build` is the "synth is current" check: it fails when a committed
`main.tf.json` differs from a fresh synthesis. Bindings land in `generated/`
and are never committed.

## How to port a stack

A port changes how a stack's configuration is written and nothing else. It is
accepted on one piece of evidence: a plan against live state, run from the PR
head before merge, that reports no changes.

### The two-pass rule

A resource's Terraform address comes from where its construct sits in the
tree. Wrapping resources in a shared construct therefore renames them, and a
rename without a `moved` block is a destroy and a create.

1. **Pass one: address-identical.** Create every resource directly in the
   stack scope, with the HCL resource name as the construct id. The plan must
   be empty with no `moved` blocks added.
2. **Pass two: shared constructs.** In a later PR, move resources into
   constructs with an explicit `moveFromId` or `overrideLogicalId` for each,
   again accepted only on an empty plan.

Never combine the two. A port that also restructures cannot show which change
caused a plan diff.

### Flattening a local module

A local HCL module the root calls is replaced by a construct
extending `FlattenedModule` (`src/flattened-module.ts`). Create each resource
through `place(resource, name, nameInModule)`: it gives the resource its root
name and records the `module.<call>[…].<type>.<name>[…]` address it had, so
`moveIntoRoot(stack)` writes one `moved` block per resource from the same
calls that create them. A `for_each` or `count` instance becomes its own
resource, and the module's conditions are decided at synthesis.

- A root name must not be a `from` of an existing `moved` block, which would
  be a cycle; `DomainBaseline` names its resources `<zone>_baseline_<name>`.
- Keep the `moved` blocks that point into the module. OpenTofu follows the
  chain, and accepts a `moved` target inside a module call that no longer
  exists.
- An `import` block cannot target an address the configuration does not
  declare: re-target each one at the root resource.
- A data source is read again at its new address and takes no `moved` block.
- Delete `modules/` and any `tests/*.tftest.hcl` in the same commit, and move
  the test's cases to assertions on a fixture stack (`synthesizeStack`).
- Accept it on a plan whose only lines are `has moved to` and whose summary
  is `Plan: 0 to add, 0 to change, 0 to destroy.`, and on the live state's
  address set, mapped through the `moved` blocks, equalling the configuration's.

### Steps

1. In `packages/homelab/src/tofu/provider-versions.json`, set
   `"bindings": true` on each provider the stack uses, then run `generate`.
   If the stack's lock selects a different version than the pin, run
   `providers:refresh -- <stack>` and treat it as a provider upgrade inside
   the same zero-change plan.
2. Write `src/stacks/<stack>.ts` extending `HomelabStack`, passing the
   stack's existing `required_version` and each provider's version
   constraint exactly as `.terraform.lock.hcl` records it.
3. Add the stack to `SYNTHESIZED_STACKS` and `STACKS` in `src/app.ts`.
4. Run `synth`, then delete every `.tf` file of the stack in the same
   commit, local modules included. A directory holding `main.tf.json` and a
   `.tf` file anywhere is refused, because nothing lints or reads HCL. A
   local module becomes a construct in the same port; see "Flattening a local
   module".
5. Add a synth test asserting the stack's resource addresses, imports,
   `moved` and `removed` blocks.
6. Drop any `externalFiles` entry in `tofu-stack-manifest.ts` for a file the
   stack now imports in TypeScript instead of reading with `file()`.
7. Validate and plan:

   ```bash
   bun run packages/homelab/scripts/tofu/tofu-stack.ts <stack> validate
   bun run packages/homelab/scripts/tofu/tofu-stack.ts <stack> plan
   ```

   Record the plan's `No changes.` in the PR's Verification. A stack Delivery
   applies automatically is planned and applied on merge, so a plan after the
   merge is too late to be the acceptance.

Never run `apply`, `import`, or any `state` subcommand as part of a port.

### Preserving addresses

- The app excludes the stack id from logical ids, so
  `new Repository(this, "monorepo", …)` is `github_repository.monorepo`.
- `for_each` becomes `TerraformIterator.fromMap` or `fromList` passed as the
  resource's `forEach`; instance keys must equal the HCL keys.
- An `import` block is `resource.importFrom(id)`. `adopt(resource, id)` in
  `src/state-migrations.ts` adds `prevent_destroy` with it. An `import` block
  addressing one `for_each` instance is `importInstance(stack, to, id)`; one
  addressing a resource inside a module call, or carrying its own `for_each`,
  is `importAddress(stack, { to, id, forEach })`.
- Constructs of one scope share one id namespace, while OpenTofu names are
  per resource type. When two types share an HCL name (a bucket and its
  lifecycle), give one a distinct construct id and
  `overrideLogicalId("<hcl name>")`.
- Keep every existing `moved` and `removed` block until state no longer holds
  the old address. `moved()`, `forget()` and `retire()` in
  `src/state-migrations.ts` write them; use those for every stack-level block
  rather than mixing them with a resource's own `moveFromId` in one stack.
- Local values that feed `jsonencode` keep their key order: build the object
  in the order the HCL declares it and pass it to `Fn.jsonencode`.
- A JSON document whose strings are data (a query, a description, SQL) is a
  local value encoded by reference, not an object passed to `Fn.jsonencode`;
  see the next section.

### Known cdktn behavior

- **Map keys are snake_cased.** A map-typed attribute passed as a plain
  object has its keys rewritten (`fooBar` becomes `foo_bar`). Wrap the map in
  `Token.asAny({...})` when the keys are data, such as labels, tags or
  header names.
- **`Fn.jsonencode` does not escape the strings inside an object.** It
  renders the object as an HCL expression and copies each string between
  quotes as-is, so a `"`, a backslash or `%{` in a value produces a broken or
  different expression. Pass such a document as a local value
  (`new TerraformLocal(this, "queries", Token.asAny(document))`) and encode
  `Fn.jsonencode(ref('local.queries["key"]'))`. A local is written as JSON,
  where every string is still a template: escape `${` as `$${` and `%{` as
  `%%{`, as `literal()` in `src/stacks/posthog.ts` does.
- **A raw `"${var.x}"` string passed to `Fn.*` is escaped** and reaches
  OpenTofu as a literal. Refer to a variable through its token
  (`variable.stringValue`), and attach a validation after the variable
  exists with `variable.addValidation({ condition, errorMessage })`.
- **Construct ids are unique per scope across resource types.** HCL may
  name two resources of different types alike
  (`b2_application_key.backup` and `onepassword_item.backup`); give the second
  another construct id and restore its address with
  `resource.overrideLogicalId("backup")`.
- **Keys are written sorted, and in JSON syntax a `dynamic` block expands
  where its key sits.** `dynamic` therefore precedes literal blocks of the
  same type, which reorders a list block such as a 1Password item's fields.
  When a block type mixes literal and `dynamic` instances, write every
  instance as a `dynamic` block in one ordered list (a literal one iterates
  `[true]`).
- **`removed` blocks and the `encryption` block have no construct.** They are
  stack overrides (`addOverride`), written by `forget()`/`retire()` and
  `encryptStateAndPlans()`. In JSON syntax the encryption `method` reference
  is the bare address `method.aes_gcm.encrypted`, not an interpolation.
  Encrypted state records its key provider's address, so a port keeps the
  stack's variable, key provider and method names.
- **`tofu validate -backend=false` does not evaluate the encryption block.**
  `src/encryption.test.ts` runs the block through a real encrypted plan, and
  an encrypted stack is proven by reading its existing encrypted state in the
  pre-merge plan.
- **A raw `"${local.x}"` passed to `Op` or `Fn` is escaped too.** Refer to a
  local's attribute through `ref("local.x.attribute")`; a raw expression
  string is passed through only as a whole attribute or local value.
- **Provider source spelling follows the pin.** A provider from OpenTofu's
  default registry synthesizes its bare `namespace/type` in lower case
  (`1password/onepassword`); OpenTofu treats that as the address the lock
  file already records.
- **`terraform_data` is `DataResource` from `cdktn`**, with no provider or
  bindings. Its `input` keys are written as given.
- **A plan never shows a provisioner.** A resource's `provisioners` list
  replaces the HCL block, and a `<<-EOT` heredoc becomes its dedented lines,
  each ended by `\n`. A changed script plans as no change, so the stack's
  test pins every script in full (`src/seaweedfs.test.ts`).
- **Generated bindings are not typechecked.** `generate` prepends TypeScript's
  no-check pragma to each one because the generator omits `override`
  modifiers; their types still flow into the stacks that import them.
- **A provider built from this repository has no registry.** A pin marked
  `"local": true` (AsusWRT) is compiled with Go into a throwaway filesystem
  mirror, and `generate` points `cdktn get` at it through
  `TF_CLI_CONFIG_FILE`; every other provider still comes from its registry.
  Its stack commits no lock file, so `providers:refresh -- asuswrt` only
  regenerates the bindings and re-synthesizes, and the stack's constraint is
  the exact pinned version.
- **`cdktn get` runs under Node**, not Bun. Synthesis runs under Bun and
  never calls the CLI or OpenTofu.
- **An output's `precondition` is dropped from JSON synthesis.** Add it with
  `output.addOverride("precondition", { condition, error_message })`.
- **A dynamically typed attribute is bound as a map.**
  `cloudflare_zone_setting.value` accepts a string or an object, but its
  binding is `{ [key: string]: any }`; pass a scalar as `Token.asAny("on")`.
- **`replaceTriggeredBy` must be an address string.** A resource object is
  written as `"${terraform_data.x}"`, which OpenTofu rejects in JSON syntax;
  pass `"terraform_data.x"`.
- **A resource used without its provider construct fails synthesis.** A stack
  that only reads `data.http` still declares `new HttpProvider(this, "http")`.

## Helpers

| Helper                      | Module                    | Use                                                          |
| --------------------------- | ------------------------- | ------------------------------------------------------------ |
| `HomelabStack`              | `src/homelab-stack.ts`    | State backend, `required_version`, provider constraints      |
| `onePasswordWrite`          | `src/onepassword.ts`      | A `onepassword_item` holding concealed fields in one section |
| `adopt`, `protect`          | `src/state-migrations.ts` | `import` with `prevent_destroy`; `prevent_destroy` alone     |
| `moved`, `forget`, `retire` | `src/state-migrations.ts` | Stack-level `moved` and `removed` blocks                     |
| `importInstance`            | `src/state-migrations.ts` | An `import` block for one `for_each` instance                |
| `importAddress`             | `src/state-migrations.ts` | An `import` block into a module call, or with its `for_each` |
| `encryptStateAndPlans`      | `src/encryption.ts`       | Passphrase variable and enforced state and plan encryption   |
| `FlattenedModule`           | `src/flattened-module.ts` | Base of a construct replacing a local module, with its moves |

Each helper but `FlattenedModule` creates resources in the scope it is given
with the id it is given, so it is safe in pass one.
