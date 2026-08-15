import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["dist/**", "eslint.config.ts"],
  }),
];

export default config;
