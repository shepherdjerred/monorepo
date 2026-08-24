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
    },
  ],
});
```

| Field              | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `name`             | dependency-cruiser rule name; appears verbatim in violation output          |
| `comment`          | why the boundary exists; printed next to every violation                    |
| `from`             | directory under the source root the rule applies from                       |
| `to`               | directories under the source root that `from` may not depend on             |
| `sourceRoot`       | top-level: directory to cruise (default `src`)                              |
| `tsConfigFileName` | top-level: tsconfig used to resolve and transpile (default `tsconfig.json`) |

Layer paths are restricted to `kebab-case` segments, so a layer path can never
inject regular-expression syntax into a generated rule.

### Nested layers

A layer may be a nested directory — `lib/amazon` as well as `amazon`. That
exists so a package whose layers do not sit directly under the source root does
not have to narrow `sourceRoot` to reach them: monarch's vendor adapters live
in `src/lib/`, and setting `sourceRoot: "src/lib"` would take `src/index.ts`
out of the always-on cycle check.

Fixtures live flat in one directory, so a nested path is flattened for its
fixture prefix: a boundary from `lib/amazon` is proven by
`architecture-fixtures/lib-amazon-<what-it-does>.ts`. A definition in which two
distinct layers would flatten onto the same prefix is refused at resolve time,
rather than letting one fixture appear to prove both.

### Mutually independent layers

Some relationships are horizontal. Monarch's seven vendor adapters have no
ordering among them; the requirement is only that none reaches into another.
Writing that as a hand-maintained 7×6 matrix states one architectural idea as
seven unrelated rules, and nothing then keeps the matrix symmetric when an
eighth vendor arrives.

```ts
export default defineArchitecture({
  isolatedGroups: [
    {
      name: "vendor-adapters-are-self-contained",
      comment: "Reading another vendor's modules couples two deep paths.",
      layers: ["lib/amazon", "lib/apple", "lib/venmo"],
    },
  ],
});
```

| Field     | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `name`    | prefix for the generated rule names (`<name>-<flattened layer>`)                       |
| `comment` | why the members must stay independent; applied to every generated rule                 |
| `layers`  | the mutually independent layers; at least two, and each needs its own negative fixture |

A group expands into ordinary boundaries during resolution, so rule generation,
fixture derivation and the coverage guard see one flat list and know nothing
about how a boundary was declared. A generated name colliding with a
hand-written boundary is caught by the same duplicate-name check as any other
collision.

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

### Wiring checklist

Fixtures are deliberately broken code, so three things have to know to leave
them alone. The first is already done for you:

| Concern    | What is needed                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint     | Nothing — `@shepherdjerred/eslint-config` ignores `**/architecture-fixtures/**/*` by default. **But `ignores` replaces that default**, so a package passing its own list must repeat the entry. |
| TypeScript | The fixture directory must not be compiled. Packages with an explicit `include` already exclude it; a package without one needs `"exclude": ["architecture-fixtures"]`.                         |
| Meta-test  | Put it where the package's `test` script **and** its `scripts/ci-test-manifest.json` entry actually look, and reach the config through `#architecture`. **Verify, do not assume** — see below.  |

A meta-test that is never discovered is the same failure this harness exists to
prevent, one level up: the suite stays green while proving nothing. Several
packages select test directories explicitly rather than using Vitest's default
include — toolkit runs only `test/*` plus `scripts`, so a meta-test under
`src/` is silently skipped. Confirm discovery against the _exact_ selectors
both the local script and the CI manifest use:

```bash
bunx vitest --config ../../vitest.config.ts list <the package's test args> \
  | grep architecture-boundaries
```

A package whose ESLint uses `projectService.allowDefaultProject` (an explicit
per-file list) also has to add the meta-test to that list — and, since these
rules are usually satisfied by moving modules, remember that relocating an
existing test file means editing its entry there too. ESLint fails with a
parsing error rather than a missing-file error, so the cause is not obvious.

## Design notes

- **Rules are derived, never duplicated.** `sourceRules()` and `fixtureRules()`
  are built from the same boundary list, differing only in the `from` path. A
  fixture cannot drift away from the rule it proves.
- **Boundaries apply to every edge kind, including `import type`.** There is no
  per-boundary type-only exemption, and that is deliberate — see
  [Why type-only exemptions are not available](#why-type-only-exemptions-are-not-available).
- **`no-circular` only matches cycles in which every edge is eager.** A cycle
  closed by an `await import()` inside a function body resolves long after
  every module has initialised, so it cannot make initialisation order
  significant. That exclusion also keeps the rule satisfiable: a module that is
  itself registered but needs the complete registry cannot import it eagerly,
  so deferring that edge is the fix, not the defect. It was measured against
  the repository before adoption — it clears only cycles their authors had
  already deferred on purpose, and rescues none of the genuinely tangled ones.
- **Each cruise is scoped to its own package.** Under Bun's isolated linker a
  `workspace:*` dependency resolves through a symlink into a sibling source
  tree, so without scoping a package would be failed by its dependencies'
  cycles — which those packages' own checks already own.
- **Programmatic, not the `depcruise` CLI.** Driving `cruise()` from Bun keeps
  the whole configuration in type-checked TypeScript, with no `.cjs` config
  files and no CommonJS/ESM interop.

## Why type-only exemptions are not available

dependency-cruiser can only label an edge `type-only` when its TypeScript
extractor is active, and it activates that extractor by resolving `typescript`
in the range `>=2.0.0 <7.0.0` through a `createRequire` anchored in its own
directory. Under Bun's isolated linker that lands on the flat fallback at
`node_modules/.bun/node_modules/typescript`, and this repository declares
`@typescript/native: npm:typescript@7.0.2` in a dozen or more packages. The
version that wins is therefore out of range, the extractor is skipped without
warning, and every `import type` arrives as a plain `["local", "import"]`.

Which package wins that flat fallback is not stable: a long-lived worktree can
resolve one version and a fresh CI install another. A gate whose correctness
depends on that is nondeterministic by construction — an
`allowTypeOnlyImports` knob would pass locally and quietly permit nothing in
CI, which is worse than not having it.

So boundaries hold for **all** edge kinds. The consequence is a design rule
rather than a limitation to work around:

> A type that two layers both need is a shared type, and belongs in a module
> both may import — not in the higher layer with an exemption pointing at it.

In practice that means a contract type moves out of the module that produces it
and into the shared layer. `tsPreCompilationDeps` is absent for the same
reason: with the extractor skipped it changes nothing in any of its settings.
