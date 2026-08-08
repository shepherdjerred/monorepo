import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: [
      "architecture-fixtures/**",
      "dist/**",
      "generated/**",
      "playwright-report/**",
      "test-results/**",
      "eslint.config.ts",
      "**/*.cjs",
    ],
  }),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Date",
          message: "Use Temporal through #shared/time instead of Date.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "date-fns", message: "Use Temporal." },
            { name: "dayjs", message: "Use Temporal." },
            { name: "luxon", message: "Use Temporal." },
            { name: "moment", message: "Use Temporal." },
          ],
        },
      ],
    },
  },
  {
    files: ["playwright.config.ts", "prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];

export default config;
