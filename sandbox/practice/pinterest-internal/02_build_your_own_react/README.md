# Build your own React, in TypeScript

Jerred Shepherd’s independent, modified TypeScript copy of [Rodrigo Pombo’s 2019 article](https://pomb.us/build-your-own-react/). The original tutorial, Didact implementation, and fiber illustrations are Pombo’s work. The prose, chapter order, and Didact architecture follow the original. This is a reading experience, with no embedded editor or runnable demos.

The exercise stays in the sandbox. Only `site` is registered as the `didact-reader` Bun workspace; neighboring exercises are independent. The static site retains the `/build-your-own-react/` base path. Publication is separate from the local build.

## Contributor commands

From the repository root, install with `bun install --frozen-lockfile`, then:

```sh
bunx turbo run build typecheck test lint --filter=didact-reader
cd sandbox/practice/pinterest-internal/02_build_your_own_react/site
bun run dev
# After a production build:
bun run test:e2e
bun run preview --host 127.0.0.1 --port 4327
```

`dev` generates content before starting Astro. Turbo orders generation before the focused checks. When editing numbered snapshots or `article.mdx` during a dev session, rerun `bun run generate`. Unit tests use Vitest; browser tests use Playwright’s desktop and mobile Chromium projects. CI runs unit tests through the repository reporting manifest and browser tests through its Playwright lane.

## Authoring

- Numbered `.ts`/`.tsx` files are independently checked snapshots. Everything after the single `// @lesson-start` marker is displayed verbatim. Everything before it provides build-time declarations and helpers for checking and type information. `original/` preserves the corresponding JavaScript for reference; it is not used for line mapping or rendering.
- `article.mdx` uses the original `CodeWave` and `ImageWave` structure. Only direct code/image children create steps. Nested `<div>` examples and code inside image-wave prose remain prose.
- A code fence references `file=./22.tsx`. `focus=118:121,125[3:18]` means visible TypeScript lines 118–121 plus columns 3–18 of line 125, inclusive and 1-based. Invalid references, missing markers, and out-of-range focus fail generation. Author focus independently from the diff; omitted focus emphasizes inserted lines.
- Keep snapshots formatted at 60 columns so annotations remain readable. Update explicit focus ranges whenever visible source changes. Do not strip annotations or derive focus from the JavaScript copies.
- Intermediate snapshots intentionally contain unfinished algorithms. Completed rendering, reconciliation, function-component, and hook milestones run from the same source in browser tests. The last snapshot adds queued actions to the preceding hooks stage. `readHook<T>` contains one narrow assertion: heterogeneous slots retain their type only when hook call order is stable.

## Reader architecture

Generation structurally parses MDX with remark, checks every inline example and displayed snapshot with strict Twoslash/TypeScript, and creates Shiki syntax tokens. Per-wave data deduplicates line text, syntax, and hover types. An ordered longest common subsequence preserves unchanged line identities, including repeated lines. Data is fetched near the viewport. The scene mounts only visible lines from the two active transition states, with two lines of overscan. A full scroll surface keeps the complete example reachable above and below the current focus without mounting every line. The focus camera stays within the example’s bounds, so short examples begin near the top and long examples fill the pane with surrounding code. Native scroll offsets and compensating line transforms preserve smooth camera motion.

Scrolling chooses a prose step. A spring (stiffness 80, damping 48, mass 8) drives fractional progress. Removed lines slide left during the first quarter; the middle half repositions retained lines and the focus camera; new lines enter from the right in the last quarter. The same progress moves and sizes a marker to the active explanation’s content, excluding the step’s surrounding padding and empty space, and crossfades fiber illustrations. Marker dimensions are measured with the step geometry; its base height changes only when the measured block changes, with transforms handling motion between blocks. The active explanation also exposes `aria-current="step"`. Illustrations stay centered within a maximum 560 × 640 px area. Reversing or interrupting a transition retargets the current spring. Reduced motion switches immediately.

Step geometry and font metrics are cached and invalidated by layout or font changes. Each frame reads pane scroll positions before writing styles. Transition maps, camera positions, syntax nodes, and column emphasis are cached outside the per-frame path. Motion changes transforms and opacity, including the prose marker; image crossfades retain at most two layers. Code layer hints are released when motion ends, and the animation loop stops at rest. Browser tests verify bounded line counts, scrolling to the final line, intermediate image crossfades, cached measurements, and no idle scene mutations.

The code scene is shared between desktop and mobile. Desktop follows the original split page: a continuous dark left half and a 420px reading column on the right. The root canvas is dark; a fixed, composited, viewport-sized paper panel supplies the right half without painting a gradient across the entire scrolling document. This keeps the background independent of content tiles during fast scrolling. Only the active explanation’s fixed code pane is visible. It fills the left half with 32px outer margins and uses 18px Berkeley Mono, including at section boundaries where a section-constrained sticky pane would slide off-screen. Below 1000px the code occupies the upper half of the viewport at 16px and the prose uses 80% of the viewport width, up to 420px. Long examples scroll inside the pane rather than shrinking the font. Desktop scrollbars appear on hover or keyboard focus; touch devices retain their scrollbars. Scrolling to another explanation resets the pane to that step’s focus. Measurements update after font loading and resize. One viewport-clamped type popup lives outside code clipping and supports pointer, focus, tap, Escape, and outside dismissal. Layout changes under a stationary pointer do not reopen a dismissed popup. Without JavaScript, the full article and expandable code remain available.

Berkeley Mono is a licensed build input reused from the existing Scout font asset. Generation validates its WOFF2 signature and copies it into ignored `site/public/fonts`, then the static build output. Never add Berkeley Mono binaries to this exercise. Generated content, font copies, browser results, and build output are ignored.

Prose and headings use the original article’s Merriweather and Montserrat fonts. Their unmodified Latin WOFF2 files are self-hosted in `site/public/typography`, with the SIL Open Font License and copyright notices from the fonts’ embedded metadata. All code and type information continue to use Berkeley Mono. Shiki’s bundled One Dark Pro theme distinguishes keywords, strings, types, functions, and numbers at build time. The original 16px/28px prose rhythm, 40px title, 23px chapter headings, and muted progress marker guide the presentation. Descriptive chapter links appear directly below the title.

The build enforces a raw initial HTML budget below 1 MB. TypeScript, Twoslash, Shiki, and MDX parsing run at build time and are absent from browser code. Tests cover article grouping, focus validation, ordered line matching, transition interruption, every numbered snapshot, strict inline examples, DOM/property/event updates, deletion, function components, queued hooks, chapter links, popup placement, responsive layout, font loading, reduced motion, and no-JavaScript reading.

## Attribution

Article, Didact examples, and fiber illustrations: Rodrigo Pombo, [original article](https://pomb.us/build-your-own-react/) and [Didact source](https://github.com/pomber/didact). The animation follows the timing and presentation of Pombo’s Code Surfer and Gatsby Waves, with a new DOM renderer. The original prose retains its historical references.

This copy is unofficial. Jerred Shepherd maintains the TypeScript and reader changes and takes responsibility for this version’s issues. The page identifies both roles prominently and directs questions about this copy to Jerred.
