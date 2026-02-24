import { recommended } from "../eslint-config/local.ts";
export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
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
      "data/",
      "scripts/",
      "web/src/**/*",
    ],
  }),
  { rules: { "no-console": "off" } },
  {
    files: ["src/queue/worker.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["src/trpc/router/conversation.router.ts"],
    rules: { "custom-rules/no-type-assertions": "off" },
  },
  {
    // web/ is not a workspace member; relative import is required for eslint config
    files: ["web/eslint.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "import/no-relative-packages": "off",
      "custom-rules/no-parent-imports": "off",
    },
  },
];
