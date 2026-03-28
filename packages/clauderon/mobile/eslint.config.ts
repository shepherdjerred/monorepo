import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    reactNative: true,
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
      "macos/",
      "windows/",
      ".expo/",
      "coverage/",
      "App.tsx",
      "index.js",
      "react-native.config.js",
      "src/types/generated/",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "eslint.config.ts",
    ],
    customRules: { reactRules: true },
  }),
  {
    rules: {
      "no-console": "off",
      // Not a workspace member — relative package imports are the only option
      "import/no-relative-packages": "off",
      // Navigation types barrel file needs re-exports
      "custom-rules/no-re-exports": "off",
    },
  },
  {
    files: ["src/components/SessionCard.tsx"],
    rules: {
      // Large component with many status helper functions
      "max-lines": ["error", { max: 530 }],
    },
  },
  {
    files: ["src/api/ConsoleClient.ts", "src/api/EventsClient.ts"],
    rules: {
      // React Native WebSocket doesn't support addEventListener
      "unicorn/prefer-add-event-listener": "off",
    },
  },
  {
    files: ["src/types/*.d.ts"],
    rules: {
      // Declaration merging requires interface, not type
      "@typescript-eslint/consistent-type-definitions": "off",
      // Must match built-in method signatures for declaration merging
      "@typescript-eslint/method-signature-style": "off",
      // `export {}` needed to make .d.ts files into modules for declare global
      "unicorn/require-module-specifiers": "off",
    },
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
