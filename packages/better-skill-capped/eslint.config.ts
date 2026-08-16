import { recommended } from "@shepherdjerred/eslint-config";
import pluginQuery from "@tanstack/eslint-plugin-query";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["dist/**", "eslint.config.ts"],
  }),
  ...pluginQuery.configs["flat/recommended"],
];

export default config;
