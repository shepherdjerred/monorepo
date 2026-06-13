import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    // New leaderboard/overlay tests are part of the tsconfig project (typed by
    // projectService directly). The pre-existing tests stay excluded from the
    // tsconfig (some use bun:test globals without importing, or hit prom-client
    // typing quirks) and are linted via the default project — kept at the
    // 8-file cap.
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/config/index.test.ts",
        "src/emulator/constants.test.ts",
        "src/emulator/png.test.ts",
        "src/input/input-latency-tracker.test.ts",
        "src/stream/overlay.test.ts",
        "src/stream/stream-observer.test.ts",
        "src/webserver/dispatch.test.ts",
      ],
    },
  }),
  {
    files: ["src/config/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // prisma.config.ts is loaded by the Prisma CLI, where process.env (not
    // Bun.env) is the right API. Mirrors the birmel backend.
    files: ["prisma.config.ts"],
    rules: {
      "custom-rules/prefer-bun-apis": "off",
    },
  },
];
export default config;
