# React performance reference

Adapted selectively from Vercel Engineering's `react-best-practices` rules.
Apply these as review prompts in the existing Bun/Vite workflow; they are not a
Next.js or Vercel deployment requirement.

## Highest-impact checks

1. Remove request waterfalls: start independent promises early and await them as
   late as the UI boundary permits.
2. Reduce initial JavaScript: avoid unnecessary barrel imports, defer optional
   features, and use route/component-level lazy loading where it improves the
   measured bundle.
3. Prevent redundant client work: deduplicate fetches, keep effect dependencies
   precise, and derive values during render when no synchronization is needed.
4. Keep server work parallel and cache only with an explicit invalidation and
   ownership model.
5. Measure before and after with the project's Vite build, bundle analyzer,
   browser profiler, and tests.

## Review boundaries

Do not add a memo, cache, effect, or dynamic import only because a rule mentions
it. Preserve behavior, accessibility, and the repo's test setup; favor the
simplest change backed by a measurement. The upstream source and pinned commit
are recorded in `public-sources.json`.
