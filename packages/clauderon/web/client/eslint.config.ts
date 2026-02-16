import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    customRules: {
      codeOrganization: false,
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
      "src/generated/",
    ],
  }),
];
