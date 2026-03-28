import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
  }),
  // Published library entry point needs re-exports
  {
    files: ["src/index.ts"],
    rules: { "custom-rules/no-re-exports": "off" },
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
