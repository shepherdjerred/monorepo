import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/clauderon-client.test.ts",
        "src/console-client.test.ts",
        "src/events-client.test.ts",
      ],
    },
  }),
  {
    files: ["src/index.ts"],
    rules: {
      // Library barrel file - re-exports are the public API surface
      "custom-rules/no-re-exports": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      // Test files create mock WebSocket objects and parse mock responses
      "custom-rules/no-type-assertions": "off",
      // Test suites can be long
      "max-lines-per-function": "off",
    },
  },
];
