import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["dist/**", "target/**", "eslint.config.ts"],
  }),
  {
    files: ["vite.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];

export default config;
