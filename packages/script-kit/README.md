# Script kit

`@shepherdjerred/script-kit` holds the small, self-contained script helpers that
product packages share with repository tooling. It is a leaf workspace: it has
no workspace dependencies, so editing Delivery, the ops model or the version
catalog never invalidates a package that only needs these helpers.

| Export                     | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `./run-temporal-node.ts`   | Run a Temporal replay script under the mise-pinned Node binary       |
| `./temporal-replay.ts`     | Replay Workflow histories and build operator connection options      |
| `./temporal-tend-lease.ts` | Acquire a `toolkit tend` lease for a locally started Temporal server |
| `./commit-message.ts`      | Validate commit messages against the repository's types and scopes   |

Add a helper here only when it imports no other workspace package. Helpers that
need Delivery, the ops model or the version catalog belong in `scripts/`
(`@shepherdjerred/root-scripts`), which depends on this package.

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/script-kit
```
