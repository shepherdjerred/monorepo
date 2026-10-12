---
title: AsusWRT import options
description: Import-script modes for existing router configuration and newly managed Mario Kart forwards.
---

The [router import script](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/asuswrt/import.sh)
adopts existing device configuration into OpenTofu state.

## Modes

| Argument                      | Behavior                                                                                             | Requirement                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| None                          | Import existing configuration; skip Mario Kart forwards missing from state so apply can create them. | Use for first activation.               |
| `--mario-kart-forwards-exist` | Also adopt the Mario Kart HTTP and HTTPS forwards when missing from state.                           | Both rules already exist on the router. |

## Common behavior

| Condition                           | Result                                            |
| ----------------------------------- | ------------------------------------------------- |
| Resource is already in state        | Skip its import.                                  |
| State listing fails                 | Stop before importing.                            |
| An import fails                     | Stop; earlier successful imports remain in state. |
| Unknown argument or extra arguments | Reject the invocation.                            |

## Related

- [Apply the router stack](/how-to/apply-the-asuswrt-stack/)
- [Cut over Mario Kart to direct HTTPS](/how-to/cut-over-mario-kart-direct-ingress/)
