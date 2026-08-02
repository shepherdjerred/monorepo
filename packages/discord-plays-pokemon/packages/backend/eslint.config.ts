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
        "src/game/game-save-details.test.ts",
        "src/game/spatial/spatial-snapshot.test.ts",
        "src/discord/chord-validator.test.ts",
        "src/discord/chord-executor.test.ts",
        "src/discord/event-notifier.test.ts",
        "src/discord/message-handler.test.ts",
        "src/discord/slashCommands/commands/goal.test.ts",
        "src/emulator/audio/analysis.test.ts",
        "src/emulator/audio/audio-fingerprint.test.ts",
        "src/emulator/audio/m4a-handlers-basic.test.ts",
        "src/emulator/bios.test.ts",
        "src/emulator/buttons.test.ts",
        "src/emulator/engine-observation.test.ts",
        "src/emulator/emulator-input-lease.test.ts",
        "src/emulator/emulator-symbols.integration.test.ts",
        "src/emulator/flash-persistence.test.ts",
        "src/goal/codex-command.test.ts",
        "src/goal/catch-evidence.test.ts",
        "src/goal/benchmark-evaluator.test.ts",
        "src/goal/benchmark-harness.test.ts",
        "src/goal/benchmark-save-oracle.test.ts",
        "src/goal/benchmark-telemetry.test.ts",
        "src/goal/codex-jsonl.test.ts",
        "src/goal/codex-trace.test.ts",
        "src/goal/discord-message.test.ts",
        "src/goal/e2e-goal.integration.test.ts",
        "src/goal/game-controller-interact.test.ts",
        "src/goal/game-controller.test.ts",
        "src/goal/game-state-summary.test.ts",
        "src/goal/goal-manager.test.ts",
        "src/goal/goal-control-gate.test.ts",
        "src/goal/goal-input-lease.test.ts",
        "src/goal/goal-memory.test.ts",
        "src/goal/history-summary.test.ts",
        "src/goal/knowledge.test.ts",
        "src/goal/pokemonctl-output.test.ts",
        "src/goal/pricing.test.ts",
        "src/observability/metrics.test.ts",
        "src/stream/stream-machine.test.ts",
        "src/stream/orchestrator-machine.test.ts",
        "src/stream/audio-transport.test.ts",
      ],
      // Test files are excluded from tsconfig (bun test globals aren't visible
      // to tsc), so they fall to the default project; raise the cap.
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 60,
    },
  }),
  {
    files: ["src/config/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // The goal benchmark worker is streamed as text and executed with its
    // working directory set to an arbitrary target checkout, so it cannot
    // import harness-owned helpers (they would module-not-found on comparison
    // checkouts made before the helper existed). It therefore inlines its
    // boot-readiness glue — kept in sync with
    // src/goal/benchmark-worker-boot-readiness.ts, which holds the unit-tested
    // copy — which pushes this single self-contained file past the shared
    // 500-line module cap.
    files: ["scripts/goal-benchmark-worker.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 700, skipBlankLines: false, skipComments: true },
      ],
    },
  },
];
export default config;
