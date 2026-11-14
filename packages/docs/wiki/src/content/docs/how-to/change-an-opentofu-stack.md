---
title: Change an OpenTofu stack
description: Edit a stack's TypeScript source, re-synthesize its committed configuration, validate and plan it, and follow Delivery's plan and apply after merge.
sidebar:
  order: 10
---

Every stack is changed in TypeScript, re-synthesized, and applied by
Delivery after merge. Never edit `main.tf.json` by hand, and never add a
`.tf` file to a stack directory: the stack runner refuses it.
[One platform model, two synthesizers](/explanation/homelab/one-platform-model-two-synthesizers/)
explains the design.

## 1. Edit the source

| To change                              | Edit                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| A stack's resources                    | `packages/homelab-cdktn/src/stacks/<stack>.ts`, or the files under `<stack>/` |
| A public hostname or static site       | [`platform-model.json`](packages/homelab/src/platform-model.json)             |
| A platform stack's registry of objects | `packages/homelab/src/tofu/<stack>/desired-state.json`                        |
| A provider version                     | [`provider-versions.json`](packages/homelab/src/tofu/provider-versions.json)  |

:::caution
A construct id is the resource's address. Renaming one, or moving it into
another construct, destroys and recreates the resource unless a `moved` block
goes with it. Use the helpers under
[Preserving addresses](packages/homelab-cdktn/README.md#preserving-addresses).
:::

## 2. Synthesize

1. Generate the provider bindings. Do this once per checkout, and again after
   a provider version changes:

   ```bash
   bunx turbo run generate --filter=@homelab/cdktn
   ```

2. Rewrite the committed configuration:

   ```bash
   bun run --cwd packages/homelab-cdktn synth
   ```

3. If you changed a provider version, refresh the stack's lock file, bindings
   and synthesis in one command instead:

   ```bash
   bun run --cwd packages/homelab-cdktn providers:refresh -- <stack>
   ```

4. Stage the source together with the regenerated
   `packages/homelab/src/tofu/<stack>/main.tf.json`, and
   `.terraform.lock.hcl` when it moved.

## 3. Check it locally

```bash
bunx turbo run build typecheck test lint --filter=@homelab/cdktn
bun packages/homelab/scripts/tofu/tofu-stack.ts <stack> validate
```

`build` fails when a committed `main.tf.json` differs from a fresh synthesis.
`validate` runs without a backend or credentials.

## 4. Plan against live state

1. Supply the state backend and stack credentials listed under
   [Prerequisites](packages/homelab/src/tofu/README.md#prerequisites).
2. Plan from the branch head:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts <stack> plan
   ```

3. Compare the plan with your intent, using this table.

   | Change                         | The plan must show                                      |
   | ------------------------------ | ------------------------------------------------------- |
   | Refactor or provider upgrade   | `No changes.`                                           |
   | Move into a construct          | Only `has moved to` lines, and `0 to add, 0 to destroy` |
   | New, changed or removed object | Exactly those resources                                 |

4. Record the plan summary in the pull request's Verification.

:::caution
Plan before merge. Delivery applies an `automatic` stack as soon as the merge
builds, so a plan read afterwards is too late to stop a surprise. Do not run
`apply` from the branch for a stack Delivery applies.
:::

## 5. Let CI check the pull request

CI validates configuration and never plans or applies it.

| Check           | What it proves                                                                        |
| --------------- | ------------------------------------------------------------------------------------- |
| `tofu-validate` | Committed `main.tf.json` files match a fresh synthesis; every stack passes validation |
| `verify`        | The cdktn typecheck, tests and lint pass, and no stack reads an undeclared file       |

Wait for it with `toolkit ci wait <PR>`.

## 6. Follow Delivery after merge

The `main` build freezes each stack's directory as an immutable archive and
registers it with Delivery as the `tofu-<stack>` service. What happens next
depends on the stack's mode in
[`platform-policy.json`](packages/ops-model/platform-policy.json).

| Mode            | After merge                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `automatic`     | Delivery plans and applies with no approval.                                                                                |
| `reviewed-plan` | Delivery saves a plan and waits. [Approve or reject it](/how-to/cut-a-homelab-release/#approve-or-reject-an-opentofu-plan). |
| `operator-only` | Delivery does not execute it. Apply it yourself with `tofu-stack.ts <stack> apply`, using the stack owner's credentials.    |
| `validate-only` | Nothing applies. The stack exists to be validated.                                                                          |

1. Find the stack's deployment:

   ```bash
   toolkit deploy status --json
   ```

2. Wait for it to finish:

   ```bash
   toolkit deploy wait DEPLOYMENT_ID --json
   ```

3. If it ends `recovery-required`, follow
   [Recover a deployment that requires recovery](/how-to/cut-a-homelab-release/#recover-a-deployment-that-requires-recovery).

## Related

- [OpenTofu stacks README](packages/homelab/src/tofu/README.md) — what each
  stack manages and the credentials it needs.
- [cdktn README](packages/homelab-cdktn/README.md) — port rules, helpers and
  known cdktn behavior.
- [Apply the asuswrt stack](/how-to/apply-the-asuswrt-stack/) — the one stack
  applied from the home LAN.
- [Rotate LLM provider credentials](/how-to/rotate-provider-credentials/) —
  desired-state changes for the provider stacks.
