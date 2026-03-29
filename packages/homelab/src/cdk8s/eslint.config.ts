import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  { rules: { "no-console": "off" } },
  {
    files: ["src/misc/modded-minecraft.ts"],
    rules: { "no-secrets/no-secrets": "off" },
  },
  {
    ignores: ["generated/"],
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
