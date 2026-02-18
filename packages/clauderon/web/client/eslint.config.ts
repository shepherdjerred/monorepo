import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/ClauderonClient.test.ts",
        "src/ConsoleClient.test.ts",
        "src/EventsClient.test.ts",
      ],
    },
  }),
];
