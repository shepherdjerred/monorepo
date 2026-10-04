import { parseArgs } from "node:util";
import { z } from "zod";
import { preview } from "./preview.ts";
import { readSession, request } from "./protocol.ts";
import { smoke, tour, viewpoint } from "./scripts.ts";

const parsed = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    session: { type: "string" },
    args: { type: "string" },
    world: { type: "string" },
    vanilla: { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const action = parsed.positionals[0];
  if (action === undefined || parsed.values.help) {
    process.stdout.write(
      "client preview [--world <directory>] [--vanilla] [--verify]\nclient <status|look|input|attack|use|hotbar|inventory|click|command|capture|release|viewpoint|tour|smoke|stop> --session <session.json> [--args '<JSON object>']\n",
    );
    return;
  }
  if (action === "preview") {
    await preview({
      vanilla: parsed.values.vanilla,
      verify: parsed.values.verify,
      ...(parsed.values.world === undefined
        ? {}
        : { world: parsed.values.world }),
    });
    return;
  }
  const session = await readSession(
    z.string().min(1).parse(parsed.values.session),
  );
  const args = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(parsed.values.args ?? "{}"));
  if (action === "tour") {
    await tour(session);
    return;
  }
  if (action === "smoke") {
    await smoke(session);
    return;
  }
  if (action === "viewpoint") {
    await viewpoint(session, z.string().parse(args["name"]));
    return;
  }
  process.stdout.write(
    `${JSON.stringify(await request(session, action, args), null, 2)}\n`,
  );
}

function reportFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof AggregateError)
    for (const cause of error.errors) reportFailure(cause);
}

await main().catch((error: unknown) => {
  reportFailure(error);
  process.exitCode = 1;
});
