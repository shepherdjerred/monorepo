import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/config/index.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/chordParser.test.ts",
        "src/game/command/commandInput.test.ts",
      ],
    },
  }),
  {
    rules: {
      // Legacy project has unresolved types from winston logger and selenium
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Legacy codebase uses type guards extensively
      "custom-rules/no-type-guards": "off",
    },
  },
];
