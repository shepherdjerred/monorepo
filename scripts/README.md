# Repository scripts

This workspace owns repository verification and CI/release automation. Run its
checks through `bunx turbo run typecheck test lint --filter=@shepherdjerred/root-scripts`
from the repository root. The export map in `package.json` defines the helpers
that other workspaces can import.

The `build` task in `turbo.json` has no command or generated artifacts. It gives
Turbo a dependency hash for those exported source helpers, their declarations
and their workspace dependencies. Consumers therefore invalidate when a helper
changes without inheriting unrelated release catalog and pin-state changes.
The root scripts' own tests, lint and typecheck retain their complete inputs
and dependency graph.

When adding an export or a local import from an exported helper, keep that
source in the `build.inputs` patterns. An imported workspace package also needs
its build dependency in `build.dependsOn`. The export-closure and real Turbo
cache regressions in `ci/root-library-inputs.test.ts` enforce this contract.
