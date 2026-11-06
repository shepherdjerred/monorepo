import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { defineCaptureSuite, selectScenarios, SuiteSchema } from "./define.ts";
import { awsStore } from "./aws-store.ts";
import { runSuite, replaySuite, renderSuite } from "./orchestrate.ts";

export async function suiteMain(args: string[]): Promise<void> {
  const parsed = parseArgs({args, allowPositionals: true, options: {
    scenario: {type: "string"}, shot: {type: "string"}, runtime: {type: "string"}, help: {type: "boolean"},
  }});
  const [action, identifier] = parsed.positionals;
  if (action === undefined || parsed.values.help === true) {
    process.stdout.write("toolkit mc capture suite check|list <suite.ts|tsmc> [--scenario ID|--shot ID]\n");
    return;
  }
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const file = identifier === "tsmc" || action === "render" || action === "replay" ? path.join(root, "packages/the-storm/tools/captures/suite.ts") : path.resolve(z.string().min(1).parse(identifier));
  const imported: unknown = await import(pathToFileURL(file).href);
  const module = z.object({default: SuiteSchema}).parse(imported);
  const suite = defineCaptureSuite(module.default);
  const selected = selectScenarios(suite, {
    ...(parsed.values.scenario === undefined ? {} : {scenario: parsed.values.scenario}),
    ...(parsed.values.shot === undefined ? {} : {shot: parsed.values.shot}),
  });
  if (action === "check" || action === "list") {
    process.stdout.write(JSON.stringify({suite: suite.id, scenarios: selected.map(s => ({id: s.id, shots: s.shots.map(p => p.name)}))}, null, 2)+"\n");
    return;
  }
  const options = {repoRoot: root, suiteFile: file, store: awsStore("the-storm-capture-fixtures"),
    ...(parsed.values.scenario === undefined ? {} : {scenario: parsed.values.scenario}),
    ...(parsed.values.shot === undefined ? {} : {shot: parsed.values.shot})};
  if (action === "run") {
    const result = await runSuite({...options, runtime: z.string().min(1).parse(parsed.values.runtime)});
    process.stdout.write(JSON.stringify(result)+"\n"); return;
  }
  if (action === "replay") {process.stdout.write(JSON.stringify(await replaySuite(options, z.uuid().parse(identifier)))+"\n");return;}
  if (action === "render") return renderSuite(options, z.uuid().parse(identifier));
  throw new Error(`Unknown suite action ${action}`);
}
