import { recommended } from "@shepherdjerred/eslint-config";

// Annotating with recommended()'s own return type (rather than letting the type
// be inferred) keeps tsc from emitting TS2883 "inferred type ... cannot be named
// without a reference to ... @typescript-eslint/utils" — and referencing it via
// `typeof recommended` binds to the exact copy the config package ships, so the
// nested-vs-root type identities don't diverge.
const config: ReturnType<typeof recommended> = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    rules: {
      // These are operator CLIs: stdout is the interface.
      "no-console": "off",
      // Standalone script dir with no package import-alias infrastructure;
      // relative parent imports are the only way to reach shared modules.
      "custom-rules/no-parent-imports": "off",
    },
  },
  {
    // Recovered whole from the deleted scripts/ci pipeline generator (which
    // carried a higher limit); a battle-tested single-file merge gate — not
    // worth splitting to satisfy a line count.
    files: ["wait-for-greptile.ts"],
    rules: {
      "max-lines": "off",
    },
  },
];
export default config;
