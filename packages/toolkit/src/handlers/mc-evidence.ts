import path from "node:path";
import { z } from "zod";
import {
  EvidencePageSchema,
  EvidenceQuerySchema,
  type EvidenceQuery,
} from "@shepherdjerred/mc-harness/protocol/evidence.ts";
import { daemonSend } from "#lib/mc/client.ts";
import { resolveTarget } from "#lib/mc/target.ts";
import { exportEvidence } from "#lib/mc/evidence.ts";
import { parseMcArgs } from "./mc-args.ts";

export const EVIDENCE_USAGE = `Private evidence (all accesses are audited):
  toolkit mc evidence search [--player name|uuid] [--text words] [--surface kind] [--since ISO] [--until ISO] [--limit 100] [--target id|live]
  toolkit mc evidence show <submission-uuid> [--target id|live]
  toolkit mc evidence export --output private.jsonl [same filters] [--target id|live]`;

export async function handleMcEvidence(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parseMcArgs(
    {
      target: { type: "string" },
      player: { type: "string", default: "" },
      json: { type: "boolean", default: false },
      text: { type: "string", default: "" },
      surface: { type: "string", default: "" },
      since: { type: "string", default: "1970-01-01T00:00:00Z" },
      until: { type: "string" },
      limit: { type: "string", default: "100" },
      output: { type: "string" },
    },
    rest,
    {},
  );
  const query = EvidenceQuerySchema.parse({
    action,
    player: values.player,
    text: values.text,
    surface: values.surface,
    since: values.since,
    until: values.until ?? new Date().toISOString(),
    limit: z.coerce.number().int().parse(values.limit),
    after: 0,
    id: positionals[0] ?? "",
  });
  if (positionals.length !== (action === "show" ? 1 : 0))
    throw new Error("Unexpected evidence arguments");
  if (action !== "export" && values.output !== undefined)
    throw new Error("--output is only supported by evidence export");
  if (action === "export" && values.output === undefined)
    throw new Error("Evidence export requires --output");
  const target = await resolveTarget(values.target);
  const fetchPage = (page: EvidenceQuery) =>
    daemonSend(
      EvidencePageSchema,
      "POST",
      `/targets/${encodeURIComponent(target)}/evidence`,
      { body: page },
    );
  if (action !== "export") {
    console.log(JSON.stringify(await fetchPage(query), null, 2));
    return;
  }
  const output = path.resolve(z.string().min(1).parse(values.output));
  const count = await exportEvidence(query, output, fetchPage, target);
  console.log(
    values.json
      ? JSON.stringify({ output, submissions: count })
      : `Exported ${String(count)} submissions to ${output}`,
  );
}
