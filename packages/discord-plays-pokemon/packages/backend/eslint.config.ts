import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "src/config/index.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/chord-parser.test.ts",
        "src/game/command/command-input.test.ts",
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
      // Legacy codebase uses type assertions for socket.io
      "custom-rules/no-type-assertions": "off",
      // Legacy template expressions with non-string types
      "@typescript-eslint/restrict-template-expressions": "off",
      // Legacy codebase shadows variables in callbacks
      "@typescript-eslint/no-shadow": "off",
      // Not a Bun project originally
      "custom-rules/prefer-bun-apis": "off",
      // Unresolved import paths cause error types
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
    },
  },
];
