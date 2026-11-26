import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
  {
    // The one wire contract every producer and consumer imports. Splitting it
    // would need re-declared aliases, because re-exports are banned.
    files: ["src/shared/contract.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 650, skipBlankLines: false, skipComments: true },
      ],
    },
  },
];
