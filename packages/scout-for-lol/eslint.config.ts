import {
  recommended,
  astroConfig,
  customRulesPlugin,
} from "../eslint-config/local.ts";

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
    naming: true,
    customRules: {
      zod: true,
      bun: true,
      reactRules: true,
      codeOrganization: true,
      typeSafety: true,
      promiseStyle: true,
      noDtoNaming: true,
      analysisRules: true,
    },
  }),
  ...astroConfig(),
  // Scout-specific naming convention overrides: allow PascalCase for React component variables
  {
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "variable",
          modifiers: ["const", "exported"],
          filter: { regex: "Schema$", match: false },
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "variable",
          modifiers: ["const"],
          filter: { regex: "Schema$", match: false },
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "variable",
          filter: { regex: "Schema$", match: false },
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: ["typeLike"],
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
      ],
    },
  },
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
  // Dagger index.ts - allow many parameters for external interface
  {
    files: [".dagger/src/index.ts"],
    rules: {
      "max-params": "off",
    },
  },
  // Discord files - allow type assertions/validation patterns
  {
    files: [
      "**/discord/**/*.ts",
      "**/league/discord/**/*.ts",
      "**/league/tasks/competition/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/no-type-assertions": "error",
      "custom-rules/prefer-zod-validation": "error",
      "custom-rules/prefer-bun-apis": "error",
      "custom-rules/no-re-exports": "error",
    },
  },
  // Satori-specific best practices for report components
  {
    files: ["packages/report/**/*.tsx", "packages/report/**/*.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/satori-best-practices": "error",
    },
  },
  // Prefer structured logging in backend
  {
    files: ["packages/backend/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/prefer-structured-logging": "error",
    },
  },
  // Prevent shadcn theme tokens in frontend marketing components
  {
    files: ["packages/frontend/src/**/*.tsx", "packages/frontend/src/**/*.ts"],
    ignores: [
      "packages/frontend/src/components/ui/**",
      "packages/frontend/src/components/review-tool/ui/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/no-shadcn-theme-tokens": "error",
    },
  },
];
