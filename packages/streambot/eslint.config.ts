import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      // Deliberate layer violations, rejected by `check-architecture` rather
      // than linted. This list overrides the shared config's defaults, which
      // already exclude them.
      "**/architecture-fixtures/**/*",
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  }),
  { rules: { "no-console": "off" } },
  {
    // Deliberate compatibility shims over @shepherdjerred/voice-assistant: the voice pipeline's
    // handle types, mutation gate, and shared wake-window constant moved to that package, and
    // these modules keep the historical streambot import sites for their many consumers.
    files: [
      "src/voice/attempt-context.ts",
      "src/voice/constants.ts",
      "src/voice/voice-tools.ts",
    ],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];

export default config;
