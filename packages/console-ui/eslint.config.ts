import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ react: true, tsconfigRootDir: import.meta.dirname }),
  {
    // The package entrypoint gathers the public API.
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
  {
    // The entrypoint still exports the deprecated page kit, and its tests
    // still cover it, until the page kit is deleted (K1).
    files: [
      "src/index.ts",
      "src/components/button.tsx",
      "src/components/page-kit/page.test.tsx",
      "src/components/components.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
];
export default config;
