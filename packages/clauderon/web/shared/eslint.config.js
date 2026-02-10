import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    codeOrganization: false,
    customRules: {
      codeOrganization: false,
    },
    ignores: [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/.astro/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
      "src/generated/",
    ],
  }),
];
