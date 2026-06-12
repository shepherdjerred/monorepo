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
        "src/emulator/png.test.ts",
        "src/emulator/constants.test.ts",
        "src/webserver/dispatch.test.ts",
        "src/stream/overlay.test.ts",
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
