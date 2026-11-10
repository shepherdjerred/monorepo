import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { defineCaptureSuite, selectScenarios, SuiteSchema } from "./define.ts";
import { runSuite, replaySuite, renderSuite } from "./orchestrate.ts";
import { recoverExport } from "./csi.ts";
import { docsCoverage } from "./docs-coverage.ts";
import type { CaptureSuite } from "./define.ts";
import { MC_DIR } from "#protocol/paths.ts";
import { auditCatalog } from "./catalog/audit.ts";
import { reviewCatalog } from "./catalog/review.ts";

function fixtureSelection(
  action: string | undefined,
  value: string | undefined,
) {
  if (value === undefined) return {};
  if (action !== "run")
    throw new Error("--fixture is supported only by suite run");
  return {
    fixture: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(value),
  };
}

async function checkDocs(
  action: string,
  docs: string | undefined,
  suite: CaptureSuite,
  root: string,
) {
  if (docs === undefined) return;
  if (action !== "check" || docs !== "ts-mc-docs")
    throw new Error("--docs ts-mc-docs is supported only by suite check");
  const coverage = await docsCoverage(
    suite,
    path.join(root, "packages/ts-mc-docs/public"),
    path.join(root, "packages/ts-mc-docs/src/content/docs"),
  );
  if (coverage.missing.length > 0)
    throw new Error(
      `Missing capture producers:\n${coverage.missing.join("\n")}`,
    );
  process.stdout.write(JSON.stringify(coverage) + "\n");
}

export async function suiteMain(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      scenario: { type: "string" },
      shot: { type: "string" },
      runtime: { type: "string" },
      fixture: { type: "string" },
      docs: { type: "string" },
      help: { type: "boolean" },
      out: { type: "string" },
    },
  });
  const [action, identifier] = parsed.positionals;
  if (action !== "review" && parsed.values.out !== undefined)
    throw new Error("--out is supported only by suite review");
  const fixture = fixtureSelection(action, parsed.values.fixture);
  if (action === undefined || parsed.values.help === true) {
    process.stdout.write(
      "toolkit mc capture suite check|list <suite.ts|tsmc> [--scenario ID|--shot ID]\ntoolkit mc capture suite review|audit <suite.ts|tsmc> [--scenario ID|--shot ID] [--out DIR (review only)]\ntoolkit mc capture suite check <suite.ts|tsmc> --docs ts-mc-docs\ntoolkit mc capture suite run <suite.ts|tsmc> --runtime worktree|saved:<run-id> [--fixture SHA256] [--scenario ID|--shot ID]\ntoolkit mc capture suite replay|render <run-id> [--scenario ID|--shot ID]\ntoolkit mc capture suite recover-export <export-id>\n",
    );
    return;
  }
  if (action === "recover-export")
    return recoverExport(z.uuid().parse(identifier));
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const selection = {
    ...(parsed.values.scenario === undefined
      ? {}
      : { scenario: parsed.values.scenario }),
    ...(parsed.values.shot === undefined ? {} : { shot: parsed.values.shot }),
  };
  if (action === "replay" || action === "render") {
    const options = { repoRoot: root, ...selection };
    const id = z.uuid().parse(identifier);
    if (action === "render") return renderSuite(options, id);
    process.stdout.write(JSON.stringify(await replaySuite(options, id)) + "\n");
    return;
  }
  const file =
    identifier === "tsmc"
      ? path.join(root, "packages/the-storm/tools/captures/suite.ts")
      : path.resolve(z.string().min(1).parse(identifier));
  const imported: unknown = await import(pathToFileURL(file).href);
  const module = z.object({ default: SuiteSchema }).parse(imported);
  const suite = defineCaptureSuite(module.default);
  if (action === "review" || action === "audit") {
    return catalogCommand(action, suite, root, {
      ...selection,
      out: parsed.values.out,
    });
  }
  await checkDocs(action, parsed.values.docs, suite, root);
  const selected = selectScenarios(suite, selection);
  if (action === "check" || action === "list") {
    process.stdout.write(
      JSON.stringify(
        {
          suite: suite.id,
          scenarios: selected.map((s) => ({
            id: s.id,
            shots: s.shots
              .filter(
                (p) =>
                  parsed.values.shot === undefined ||
                  p.name === parsed.values.shot,
              )
              .map((p) => p.name),
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const options = {
    repoRoot: root,
    suiteFile: file,
    ...selection,
  };
  if (action === "run") {
    const result = await runSuite({
      ...options,
      runtime: z.string().min(1).parse(parsed.values.runtime),
      ...fixture,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  throw new Error(`Unknown suite action ${action}`);
}

async function catalogCommand(
  action: string,
  suite: CaptureSuite,
  root: string,
  selection: { scenario?: string; shot?: string; out: string | undefined },
) {
  const publicRoot = path.join(root, "packages/ts-mc-docs/public");
  const catalog = await auditCatalog(
    suite,
    publicRoot,
    selection,
    path.join(root, "packages/ts-mc-docs/src/content/docs"),
  );
  const result =
    action === "audit"
      ? catalog
      : await reviewCatalog(
          catalog,
          publicRoot,
          path.resolve(
            selection.out ?? path.join(MC_DIR, "reviews", crypto.randomUUID()),
          ),
        );
  process.stdout.write(JSON.stringify(result) + "\n");
  for (const issue of catalog.issues)
    process.stderr.write(
      `[capture] ${issue.scenario}/${issue.shot}: ${issue.file}: ${issue.message}\n`,
    );
  if (catalog.issues.length > 0) process.exitCode = 1;
}
