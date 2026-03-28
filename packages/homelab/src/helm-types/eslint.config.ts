import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  { rules: { "no-console": "off" } },
  {
    files: [
      "src/type-converter.ts",
      "src/type-inference.ts",
      "src/yaml-comments.ts",
    ],
    rules: {
      "max-lines": ["error", { max: 600 }],
    },
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
