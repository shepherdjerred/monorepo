import { recommended } from "@shepherdjerred/eslint-config";

// Annotating with recommended()'s own return type (rather than letting the type
// be inferred) keeps tsc from emitting TS2883 "inferred type ... cannot be named
// without a reference to ... @typescript-eslint/utils" — and referencing it via
// `typeof recommended` binds to the exact copy the config package ships, so the
// nested-vs-root type identities don't diverge.
const config: ReturnType<typeof recommended> = [
  // scripts/ci is its own lint root with its own eslint.config.ts; flat
  // config doesn't cascade, so globally ignore it here to avoid
  // double-linting it under this config's (wrong) project settings.
  { ignores: ["ci/**"] },
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
  // Grandfathered pre-existing giants — new scripts are held to the normal
  // 500-line cap. Shrink these opportunistically, never grow them.
  {
    files: ["setup.ts"],
    rules: { "max-lines": ["error", { max: 800, skipComments: true }] },
  },
];
export default config;
