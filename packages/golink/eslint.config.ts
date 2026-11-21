import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: [
      "architecture-fixtures/**",
      "generated/**",
      "dist/**",
      "test-results/**",
      "eslint.config.ts",
    ],
  }),
  {
    files: ["prisma.config.ts", "vite.config.ts"],
    // Tool subprocesses also load these files under Node.
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];

export default config;
