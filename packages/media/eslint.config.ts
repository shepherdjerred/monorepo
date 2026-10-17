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
    files: ["prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
  {
    files: ["src/migration/regex-process.ts"],
    rules: {
      // This subprocess boundary runs in both Bun tooling and Node Temporal workers.
      // Keep environment access portable; Bun APIs remain required elsewhere.
      "custom-rules/prefer-bun-apis": "off",
    },
  },
];
