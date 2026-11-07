import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["bin/*.ts", "scripts/*.ts"],
    rules: {
      "no-console": "off",
      "custom-rules/no-parent-imports": "off",
      "import/no-relative-packages": "off",
    },
  },
  {
    files: [
      "bin/executable_git_cleanup.ts",
      "bin/git_cleanup_core.ts",
      "bin/executable_restart_codex_panes.ts",
      "bin/codex_theme_restart_*.ts",
    ],
    rules: {
      "unicorn/filename-case": [
        "error",
        { case: "snakeCase", checkDirectories: false },
      ],
    },
  },
  {
    // Herdr mods are plain JS loaded by the Herdr app; the test imports the
    // mod's pure module as it ships.
    files: ["scripts/worktree-naming.test.ts"],
    rules: {
      "custom-rules/require-ts-extensions": "off",
    },
  },
];
