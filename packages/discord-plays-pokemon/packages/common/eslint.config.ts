import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
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
];
export default config;
