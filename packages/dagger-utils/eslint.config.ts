import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    naming: false,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
      ],
    },
    customRules: {
      codeOrganization: false,
      bun: false,
      zod: false,
      typeSafety: false,
    },
    ignores: [
      "sdk/",
    ],
  }),
  {
    rules: {
      "no-console": "off",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "unicorn/prefer-string-replace-all": "warn",
      "unicorn/prefer-string-raw": "off",
      "eslint-comments/disable-enable-pair": "warn",
      "eslint-comments/require-description": "warn",
      curly: "warn",
      "max-params": ["error", { max: 6 }],
    },
  },
];
