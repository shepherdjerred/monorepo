import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["generated/**", "dist/**", "eslint.config.ts"],
  }),
  {
    files: ["prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
