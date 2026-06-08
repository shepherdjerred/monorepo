import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/config/index.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/command-input.test.ts",
        "src/emulator/buttons.test.ts",
        "src/stream/stream-machine.test.ts",
        "src/stream/orchestrator-machine.test.ts",
        "src/stream/letterbox.test.ts",
      ],
    },
  }),
  {
    files: ["src/config/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
export default config;
