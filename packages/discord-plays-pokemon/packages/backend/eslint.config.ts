import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "scripts/probe-mixer.ts",
        "src/config/index.test.ts",
        "src/config/schema.test.ts",
        "src/game/command/chord.test.ts",
        "src/game/command/command-input.test.ts",
        "src/game/events/pokemon-struct.test.ts",
        "src/game/events/diff.test.ts",
        "src/game/events/snapshot.test.ts",
        "src/game/events/watcher.test.ts",
        "src/game/events/saves.test.ts",
        "src/discord/event-notifier.test.ts",
        "src/emulator/audio/analysis.test.ts",
        "src/emulator/audio/m4a-handlers-basic.test.ts",
        "src/emulator/buttons.test.ts",
        "src/emulator/emulator-symbols.integration.test.ts",
        "src/goal/discord-message.test.ts",
        "src/goal/goal-manager.test.ts",
        "src/stream/stream-machine.test.ts",
        "src/stream/orchestrator-machine.test.ts",
      ],
      // 15 test files are excluded from tsconfig (bun test globals aren't
      // visible to tsc), so they fall to the default project; raise the cap.
      // probe-mixer.ts is also excluded from tsconfig (debug script, not src).
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 21,
    },
  }),
  {
    files: ["src/config/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // probe-mixer.ts is a debug-only script used to poke the wasm mixer by
    // hand. It intentionally uses console.log for output and accesses internal
    // emulator state via a dynamic cast (there is no public accessor yet).
    // Exclude it from the strict project-service rules.
    files: ["scripts/probe-mixer.ts"],
    rules: {
      "no-console": "off",
      "custom-rules/no-type-assertions": "off",
    },
  },
];
export default config;
