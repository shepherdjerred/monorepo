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
        "src/game/events/pokemon-struct.test.ts",
        "src/game/events/diff.test.ts",
        "src/game/events/snapshot.test.ts",
        "src/game/events/watcher.test.ts",
        "src/game/events/saves.test.ts",
        "src/discord/event-notifier.test.ts",
        "src/emulator/audio/analysis.test.ts",
        "src/emulator/audio/audio-fingerprint.test.ts",
        "src/emulator/audio/m4a-handlers-basic.test.ts",
        "src/emulator/buttons.test.ts",
        "src/emulator/emulator-symbols.integration.test.ts",
        "src/goal/codex-command.test.ts",
        "src/goal/codex-jsonl.test.ts",
        "src/goal/codex-trace.test.ts",
        "src/goal/discord-message.test.ts",
        "src/goal/e2e-goal.integration.test.ts",
        "src/goal/game-state-summary.test.ts",
        "src/goal/goal-manager.test.ts",
        "src/goal/history-summary.test.ts",
        "src/goal/pricing.test.ts",
        "src/stream/stream-machine.test.ts",
        "src/stream/orchestrator-machine.test.ts",
        "src/stream/audio-transport.test.ts",
      ],
      // Test files are excluded from tsconfig (bun test globals aren't visible
      // to tsc), so they fall to the default project; raise the cap.
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40,
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
