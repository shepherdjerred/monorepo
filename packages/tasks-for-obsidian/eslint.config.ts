import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    ignores: [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.build/**/*",
      "**/.cache/**/*",
      "**/coverage/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.mdx",
      "ios/",
      "eslint.config.ts",
    ],
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
