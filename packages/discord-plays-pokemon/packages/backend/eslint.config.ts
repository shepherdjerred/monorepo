import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/config/index.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/chord-parser.test.ts",
        "src/game/command/command-input.test.ts",
      ],
    },
  }),
] satisfies TSESLint.FlatConfig.ConfigArray;
