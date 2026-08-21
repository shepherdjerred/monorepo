// Ambient types for the handful of runtime APIs the fixture loader needs,
// scoped like the package's Vitest test types: declared locally
// rather than by pulling in `bun-types` / `@types/node`, so Bun's global DOM
// types do not leak into the React Native source build (where its
// `fetch`/`AbortSignal` overloads conflict with the RN runtime types).
//
// The corpus is read off disk rather than imported because it is
// language-neutral data, not a TypeScript module — the Rust runner reads the
// same files. These declarations exist only for the test-time reader.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
}

declare module "node:path" {
  type PathApi = {
    join: (...segments: string[]) => string;
  };
  const path: PathApi;
  export default path;
}

/** Directory of the current module. Bun defines it in ES modules too. */
declare const __dirname: string;

/**
 * `env` is MUTABLE, matching `process.env`: `recurrence-timezone.test.ts`
 * assigns `Bun.env.TZ` to run the recurrence boundary under UTC-positive zones
 * that CI (UTC) would otherwise never exercise.
 */
declare const Bun: {
  readonly env: Record<string, string | undefined>;
};
