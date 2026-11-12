# @homelab/cdktn

The CDK Terrain (cdktn) application that synthesizes OpenTofu stacks. Each
ported stack is a TypeScript class in `src/stacks/<stack>.ts`, or in
`src/stacks/<stack>/index.ts` when it is split across files; `bun run synth`
writes its configuration to `packages/homelab/src/tofu/<stack>/main.tf.json`,
which is committed next to the stack's lock file.

OpenTofu stays the engine. Nothing here plans or applies: the stack runner
(`packages/homelab/scripts/tofu/tofu-stack.ts`) and Delivery read the committed
JSON exactly as they read hand-written HCL. `packages/homelab/src/tofu/README.md`
describes the stacks, their credentials and how they are run.

## Commands

```bash
bunx turbo run generate --filter=@homelab/cdktn    # provider bindings (needs tofu, Node, registry access)
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
4. Run `synth`, then delete every root `.tf` file of the stack in the same
   commit. A directory holding both `main.tf.json` and root `.tf` files is
   refused. A local module the root still calls (`modules/**`) stays HCL:
   call it with `TerraformHclModule` under its HCL name, so its resources
   keep their `module.<name>…` addresses. Flattening a module is pass two.
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

### Known cdktn behavior

- **Map keys are snake_cased.** A map-typed attribute passed as a plain
  object has its keys rewritten (`fooBar` becomes `foo_bar`). Wrap the map in
  `Token.asAny({...})` when the keys are data, such as labels, tags or
  header names.
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
- **Generated bindings are not typechecked.** `generate` prepends TypeScript's
  no-check pragma to each one because the generator omits `override`
  modifiers; their types still flow into the stacks that import them.
- **`cdktn get` runs under Node**, not Bun. Synthesis runs under Bun and
  never calls the CLI or OpenTofu.
- **A local module is copied into the synthesis and its `source` rewritten.**
  Pass `skipAssetCreationFromLocalModules: true` to `TerraformHclModule` so
  `source` stays the committed `./modules/<name>` path.
- **An output's `precondition` is dropped from JSON synthesis.** Add it with
  `output.addOverride("precondition", { condition, error_message })`.
- **A dynamically typed attribute is bound as a map.**
  `cloudflare_zone_setting.value` accepts a string or an object, but its
  binding is `{ [key: string]: any }`; pass a scalar as `Token.asAny("on")`.

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

Each helper creates resources in the scope it is given with the id it is
given, so it is safe in pass one.
