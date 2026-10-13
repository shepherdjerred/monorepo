import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: [
      "generated/**",
      "dist/**",
      "test-results/**",
      "playwright-report/**",
      "eslint.config.ts",
    ],
  }),
  {
    files: ["prisma.config.ts", "playwright.config.ts"],
    // Tool subprocesses also load these files under Node.
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
