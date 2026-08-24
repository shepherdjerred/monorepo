---
title: Why module boundaries are a lint gate
description: The reasoning behind enforcing import cycles and layer boundaries with dependency-cruiser, why some edges are deliberately exempt, and why every rule has to prove it can fail.
sidebar:
  order: 8
---

Layering only survives if something mechanical enforces it. A convention that
lives in a README decays the first time a deadline meets a convenient import,
and it decays invisibly — nothing goes red, the code just slowly stops having
the shape its authors described. So the monorepo enforces module boundaries the
same way it enforces types: as part of `lint`, on every package that opts in.

The enforcement runs on
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser), driven by
a shared workspace package, `@shepherdjerred/architecture`.

## Two different rules, one mechanism

**No eager import cycles** applies everywhere and needs no configuration. A
cycle of eager runtime imports makes module initialisation order significant:
whichever module the runtime happens to reach first sees a half-built version
of the other. The symptom is an `undefined` that appears only under a particular
entry point, which is a miserable class of bug to chase.

**Layer boundaries** are per-package and describe intent that no general rule
could infer — that a domain model must not reach for a database, that workflow
code must not import an activity implementation, that browser code must not
import server runtime. These have to be declared, because only the package's
authors know where its seams are.

Both come out of the same rule generator, so a package that wants only the
universal rule adds a dependency and one clause to its `lint` script, and never
writes a config file at all.

## One edge kind is exempt, and one cannot be

The cycle rule matches only cycles in which _every_ edge is an eager import.

An `await import()` inside a function body resolves at call time, long after
every module has finished initialising, so it cannot make initialisation order
significant. It is also the _sanctioned_ way to break a registry cycle: a module
that is itself registered, but that needs to look up the complete registry,
cannot import that registry eagerly — the registry does not exist yet. Flagging
the deferral as the defect would leave no way to comply with the rule.

That exemption is the kind of decision that quietly becomes a loophole, so it
was measured rather than argued. Across the packages under enforcement it clears
only cycles whose authors had already deferred them on purpose, with comments
explaining why, and rescues none of the genuinely tangled ones.

`import type` is a different story, and the reason is worth knowing because it
shaped the design. dependency-cruiser can only label an edge as type-only when
its TypeScript extractor is running, and it decides whether to run that
extractor by resolving `typescript` in the range `>=2.0.0 <7.0.0` from its own
directory. Under Bun's isolated linker that resolution lands on a flat fallback
shared by the whole install, and this repository pins
`@typescript/native: npm:typescript@7.0.2` in a dozen or more packages for
tsgo typechecking. The version that wins is out of range, so the extractor is
skipped silently and every `import type` looks like an ordinary import.

The tempting move is to pin something. The better reading is that a gate whose
correctness depends on which version wins a flat fallback is nondeterministic by
construction: it can pass in a long-lived worktree and mean nothing in CI. An
exemption that behaves differently in those two places is worse than no
exemption, because it reads as protection.

So boundaries hold for every edge kind, and that turns into a positive design
rule rather than a workaround: a type that two layers both need is a shared
type, and belongs in a module both are allowed to import. In practice a contract
moves out of the module that produces it and into the shared layer, which is
where a reader would look for it anyway.

## Rules are defined once, and have to prove they bite

The first version of this, in the alert dashboard, kept the real rules in one
file and a mirrored copy of them — re-scoped to point at deliberately broken
fixture files — inside a test. The mirror existed for a good reason: a rule that
cannot fail is worse than no rule, because it reads as a passing check. But two
hand-synced copies of the same intent is precisely the duplication that goes
stale, and a stale mirror proves nothing about the rule it claims to prove.

The shared harness derives the fixture rules from the same boundary list the
real check uses, changing only which directory they apply _from_. A fixture
cannot drift away from the rule it proves, because there is only one rule.

Non-vacuity is enforced rather than assumed, in three places:

- The check fails when the cruise inspected zero modules. A rule set that looks
  at nothing is the failure mode that looks most like success.
- A boundary declared without a matching negative fixture fails the package's
  meta-test before anything is cruised.
- A fixture that proves no boundary fails it too, so deleting a rule leaves
  evidence behind rather than silently orphaning a file.

## Not every boundary is a layer

"Layer" implies an ordering — this is below that, so the arrows point one way.
Plenty of real boundaries have no ordering at all. Monarch's deep paths are the
clearest case: seven directories, one per merchant, each owning that merchant's
fetch, parse, match and classify pipeline. None of them is beneath another.
What matters is only that none reaches sideways into another, because a matcher
that learns a second vendor's shape stops being independently replaceable, and
a change to one parser silently becomes a change to two deep paths.

That is expressible as a matrix of ordinary one-way rules, and the first
instinct is to write it that way. The problem is not the typing. It is that
seven directories yield forty-two clauses which state one idea as forty-two
unrelated facts, and nothing holds them symmetric: the day an eighth vendor
arrives, someone adds it to six lists and forgets the seventh, and the gap is
invisible because every rule that remains still passes. So the harness takes
the idea itself — a set of siblings, none of which may depend on another — and
generates the matrix from it. The declaration cannot be asymmetric, because
there is nothing in it to get out of step.

Each generated rule still has to earn its keep the same way a hand-written one
does, with its own committed fixture proving it can fail. Deriving the rules
does not derive the evidence.

## Each package is judged only on its own tree

Under Bun's isolated linker a `workspace:*` dependency resolves through a
symlink into a sibling package's source directory. Left alone, dependency-cruiser
follows that symlink and reports the sibling's cycles against the package that
imported it — so a small frontend would fail on a large backend's tangle, which
it neither caused nor can fix. Each cruise is therefore scoped to its own source
root. A package's dependencies are checked by their own packages' gates.

## Related

- [Why the CI pipeline has so many steps](/explanation/ci-pipeline-shape/)
- `packages/architecture/README.md` in the repository, for how to opt a package
  in and declare boundaries.
