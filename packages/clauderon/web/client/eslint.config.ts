import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/ClauderonClient.test.ts",
        "src/ConsoleClient.test.ts",
        "src/EventsClient.test.ts",
      ],
    },
    naming: false,
    customRules: {
      zod: false,
      bun: true,
      codeOrganization: false,
      typeSafety: false,
      promiseStyle: true,
    },
  }),
  {
    rules: {
      "no-console": "warn",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-code-point": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-useless-spread": "warn",
      "unicorn/prefer-global-this": "warn",
      "unicorn/prefer-string-slice": "warn",
      "unicorn/prefer-spread": "warn",
      "unicorn/escape-case": "warn",
      "unicorn/no-hex-escape": "warn",
      "unicorn/numeric-separators-style": "warn",
      "regexp/use-ignore-case": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/prefer-readonly": "warn",
      "max-lines-per-function": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
];
