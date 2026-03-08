import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    reactNative: true,
    projectService: {
      allowDefaultProject: ["src/domain/*.test.ts", "src/lib/*.test.ts"],
    },
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
