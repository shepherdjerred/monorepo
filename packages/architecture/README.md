# @shepherdjerred/architecture

Shared [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
harness for enforcing module boundaries inside a package.

Every consuming package gets one universal rule — **no runtime import cycles** —
and may declare additional **layer boundaries**. Rules are defined once, in
TypeScript, and the negative-fixture rules used to prove they can fail are
_derived_ from that same definition rather than restated.

## Adding the baseline check to a package

1. Add the dependency:

   ```jsonc
   // package.json
   "devDependencies": { "@shepherdjerred/architecture": "workspace:*" }
   ```

2. Extend the `lint` script:

   ```jsonc
   "lint": "eslint . && check-architecture"
   ```

That is the whole opt-in. `check-architecture` cruises `src/`, enforces
`no-circular`, and **fails when it finds no modules at all** — a rule set that
inspects nothing reads as a green check, which is worse than no check.

## Declaring layer boundaries

Add an `architecture.config.ts` at the package root, and expose it to the
meta-test with a subpath import (`"#architecture": "./architecture.config.ts"`
in the package's `imports`, since parent-relative imports are banned):

```ts
import { defineArchitecture } from "@shepherdjerred/architecture";

export default defineArchitecture({
  boundaries: [
    {
      name: "workflows-do-not-import-activity-implementations",
      comment:
        "Workflow code runs in a deterministic sandbox; importing an activity " +
        "implementation drags its I/O into that sandbox.",
      from: "workflows",
      to: ["activities"],
      allowTypeOnlyImports: true,
    },
  ],
});
```

| Field                  | Meaning                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `name`                 | dependency-cruiser rule name; appears verbatim in violation output          |
| `comment`              | why the boundary exists; printed next to every violation                    |
| `from`                 | directory under the source root the rule applies from                       |
| `to`                   | directories under the source root that `from` may not depend on             |
| `allowTypeOnlyImports` | permit `import type` across the boundary                                    |
| `sourceRoot`           | top-level: directory to cruise (default `src`)                              |
| `tsConfigFileName`     | top-level: tsconfig used to resolve and transpile (default `tsconfig.json`) |

Layer names are restricted to `kebab-case`, so a layer name can never inject
regular-expression syntax into a generated rule.

## Proving the rules are not vacuous

A boundary is only worth having if it can fail. Each package that declares
boundaries commits one deliberate violation per boundary under
`architecture-fixtures/`, named `<from-layer>-<what-it-does>.ts`, and runs a
meta-test:

```ts
import { describe, expect, it } from "vitest";
import {
  cruiseArchitectureFixtures,
  expectedFixtureRuleNames,
} from "@shepherdjerred/architecture";
import architecture from "#architecture";

describe("architecture boundaries", () => {
  it("rejects a committed negative fixture for every declared boundary", async () => {
    const result = await cruiseArchitectureFixtures({
      packageRoot,
      definition: architecture,
    });
    expect(result.violatedRuleNames).toEqual(
      expectedFixtureRuleNames(architecture),
    );
    expect(result.errorCount).toBe(result.fixtureFiles.length);
  });
});
```

`cruiseArchitectureFixtures` throws — before it cruises anything — when a
boundary has no fixture, or when a fixture proves no boundary. Adding a rule
without evidence that it bites fails the suite.

## Design notes

- **Rules are derived, never duplicated.** `sourceRules()` and `fixtureRules()`
  are built from the same boundary list, differing only in the `from` path. A
  fixture cannot drift away from the rule it proves.
- **`tsPreCompilationDeps: "specify"`.** Without it, `import type` edges are
  invisible to dependency-cruiser and `allowTypeOnlyImports` would be
  decorative. With it, a strict boundary rejects even a type import, and a
  boundary that opts in genuinely allows one.
- **`no-circular` ignores cycles closed by an `import type`.** Those disappear
  at compile time and cannot make module initialisation order significant.
- **Each cruise is scoped to its own package.** Under Bun's isolated linker a
  `workspace:*` dependency resolves through a symlink into a sibling source
  tree, so without scoping a package would be failed by its dependencies'
  cycles — which those packages' own checks already own.
- **Programmatic, not the `depcruise` CLI.** Driving `cruise()` from Bun keeps
  the whole configuration in type-checked TypeScript, with no `.cjs` config
  files and no CommonJS/ESM interop.
