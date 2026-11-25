import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["dist/**", "target/**", "test-results/**", "eslint.config.ts"],
  }),
  {
    files: ["vite.config.ts"],
    // Tool subprocesses also load Vite config under Node.
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];

export default config;
