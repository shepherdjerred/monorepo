import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    reactNative: true,
    // The package tsconfigs (app + scripts/e2e/contract-tests) cover every
    // linted file via the project service; allowDefaultProject entries became
    // hard "also found in the project service" errors and were removed.
    projectService: true,
    ignores: [
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
      // RN-specific
      "android/",
      "ios/",
      // Config file is not in tsconfig
      "eslint.config.ts",
      // Ambient type declarations
      "react-native.d.ts",
    ],
    customRules: { reactRules: true },
  }),
  {
    rules: {
      "no-console": "off",
      // Hermes doesn't support Array#toSorted()
      "unicorn/no-array-sort": "off",
      // TODO: move color literals to theme constants and inline styles to StyleSheet
      "react-native/no-color-literals": "off",
      "react-native/no-inline-styles": "off",
    },
  },
  {
    files: [
      "src/domain/types.ts",
      "src/domain/schemas.ts",
      "src/domain/priority.ts",
      "src/domain/status.ts",
    ],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
