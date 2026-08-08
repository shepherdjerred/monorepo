import { describe, expect, it } from "bun:test";
import { cruise } from "dependency-cruiser";
import { z } from "zod";

const CruiseOutputSchema = z.object({
  summary: z.object({
    error: z.number().int(),
    violations: z.array(
      z.object({
        rule: z.object({ name: z.string() }),
      }),
    ),
  }),
});

describe("dependency-cruiser layer boundaries", () => {
  it("rejects the committed negative fixtures", async () => {
    const packageRoot = import.meta.dir.replace(/\/src\/server$/u, "");
    const result = await cruise(
      [
        "architecture-fixtures/application-imports-server.ts",
        "architecture-fixtures/client-imports-server.ts",
        "architecture-fixtures/domain-imports-infrastructure.ts",
      ],
      {
        baseDir: packageRoot,
        validate: true,
        ruleSet: {
          forbidden: [
            {
              name: "negative-domain-is-pure",
              severity: "error",
              from: { path: "(^|/)architecture-fixtures/domain" },
              to: { path: "(^|/)src/infrastructure" },
            },
            {
              name: "negative-application-does-not-import-server",
              severity: "error",
              from: { path: "(^|/)architecture-fixtures/application" },
              to: { path: "(^|/)src/server" },
            },
            {
              name: "negative-client-does-not-import-server-runtime",
              severity: "error",
              from: { path: "(^|/)architecture-fixtures/client" },
              to: { path: "(^|/)src/server" },
            },
          ],
        },
        doNotFollow: { path: "node_modules" },
        outputType: "json",
        tsConfig: { fileName: `${packageRoot}/tsconfig.json` },
      },
    );
    if (typeof result.output !== "string") {
      throw new TypeError("dependency-cruiser JSON reporter returned non-text");
    }
    const output = CruiseOutputSchema.parse(JSON.parse(result.output));
    const violatedRules = output.summary.violations.map(
      (violation) => violation.rule.name,
    );
    expect(output.summary.error).toBe(3);
    expect(violatedRules).toContain("negative-domain-is-pure");
    expect(violatedRules).toContain(
      "negative-application-does-not-import-server",
    );
    expect(violatedRules).toContain(
      "negative-client-does-not-import-server-runtime",
    );
  });
});
