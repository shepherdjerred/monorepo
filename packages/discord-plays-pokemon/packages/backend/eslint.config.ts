import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/config/index.test.ts",
        "src/config/schema.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/command-input.test.ts",
        "src/emulator/buttons.test.ts",
        "src/goal/discord-message.test.ts",
        "src/goal/goal-manager.test.ts",
        "src/stream/stream-machine.test.ts",
        "src/stream/orchestrator-machine.test.ts",
      ],
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 10,
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
