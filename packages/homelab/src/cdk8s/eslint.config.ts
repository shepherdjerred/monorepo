import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  { rules: { "no-console": "off" } },
  {
    files: ["src/misc/modded-minecraft.ts"],
    rules: { "no-secrets/no-secrets": "off" },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // Imports of the loose CRD shim are silent strict-typing regressions —
      // route through the strict types in src/cdk8s-types/cfargotunnel.ts.
      // See packages/docs/plans/2026-05-26_cdk8s-cfargotunnel-strict-types.md.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/generated/imports/networking.cfargotunnel.com*",
                "@shepherdjerred/homelab/cdk8s/generated/imports/networking.cfargotunnel.com*",
              ],
              message:
                "Import from @shepherdjerred/homelab/cdk8s/src/cdk8s-types/cfargotunnel.ts instead — it provides strict types that catch CRD field casing typos at compile time.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["generated/"],
  },
];
export default config;
