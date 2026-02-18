import { recommended, customRulesPlugin } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "packages/*/tailwind.config.ts",
      ],
    },
    tsconfigPaths: [
      "./packages/backend/tsconfig.json",
      "./packages/data/tsconfig.json",
      "./packages/report/tsconfig.json",
      "./packages/frontend/tsconfig.json",
      "./packages/desktop/tsconfig.json",
    ],
    ignores: [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/.astro/**/*",
      ".dagger/sdk/**/*",
      "**/src-tauri/target/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.astro",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
    react: true,
    accessibility: true,
    customRules: { noDtoNaming: true, noShadcnThemeTokens: true },
  }),
  // Block twisted DTO imports
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "Use Bun.file() / Bun.write() instead of Node fs." },
            { name: "node:fs", message: "Use Bun.file() / Bun.write() instead of Node fs." },
            { name: "fs/promises", message: "Use Bun.file() / Bun.write() instead of Node fs/promises." },
            { name: "child_process", message: "Use Bun.spawn() / Bun.$ instead of Node child_process." },
            { name: "crypto", message: "Use Bun.CryptoHasher or Web Crypto API instead of Node crypto." },
            { name: "path", message: "Use Bun.pathToFileURL or import from 'node:path' if needed." },
          ],
          patterns: [
            {
              group: ["twisted/dist/models-dto*"],
              message:
                "Do not import DTO types from twisted. Use Raw* Zod schemas from @scout-for-lol/data instead (e.g., RawMatch, RawSummonerLeague).",
            },
          ],
        },
      ],
    },
  },
  // Satori best practices for report components
  {
    files: ["packages/report/**/*.tsx", "packages/report/**/*.ts"],
    plugins: { "custom-rules": customRulesPlugin },
    rules: { "custom-rules/satori-best-practices": "error" },
  },
  // Structured logging in backend
  {
    files: ["packages/backend/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
    plugins: { "custom-rules": customRulesPlugin },
    rules: { "custom-rules/prefer-structured-logging": "error" },
  },
  // No shadcn theme tokens in frontend marketing
  {
    files: ["packages/frontend/src/**/*.tsx", "packages/frontend/src/**/*.ts"],
    ignores: [
      "packages/frontend/src/components/ui/**",
      "packages/frontend/src/components/review-tool/ui/**",
      "**/*.test.*",
    ],
    plugins: { "custom-rules": customRulesPlugin },
    rules: { "custom-rules/no-shadcn-theme-tokens": "error" },
  },
  // Dagger functions external interface
  { files: [".dagger/src/index.ts"], rules: { "max-params": "off" } },
  // Scripts and frontend — console output is expected
  {
    files: ["scripts/**/*.ts", "**/scripts/**/*.ts", "packages/frontend/**/*.ts", "packages/frontend/**/*.tsx", "packages/report/**/*.ts"],
    rules: { "no-console": "off" },
  },
  // Library index files re-export intentionally
  {
    files: [
      "packages/data/src/index.ts",
      "packages/data/src/model/arena/index.ts",
      "packages/data/src/model/index.ts",
      "packages/data/src/sound-pack/index.ts",
      "packages/report/src/browser.ts",
      "packages/report/src/index.ts",
      "packages/ui/src/components/sound-pack-editor/index.ts",
      "packages/ui/src/index.ts",
    ],
    rules: { "custom-rules/no-re-exports": "off" },
  },
  // Large test/component files
  {
    files: [
      "packages/data/src/model/competition.test.ts",
      "packages/ui/src/components/sound-pack-editor/condition-builder.tsx",
    ],
    rules: { "max-lines": "off" },
  },
  // Vite config runs in Node context, not Bun
  {
    files: ["packages/desktop/vite.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
