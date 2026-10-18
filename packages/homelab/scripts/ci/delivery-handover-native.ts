import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  loadWoodpeckerConfig,
  woodpeckerJson,
} from "@shepherdjerred/toolkit/lib/woodpecker/ci.ts";
import type { HandoverDescriptor } from "./delivery-handover-selection.ts";

const PipelineStatus = z.enum(["pending", "running", "blocked"]);
type PipelineReader = {
  config: typeof loadWoodpeckerConfig;
  json: typeof woodpeckerJson;
};
const pipelineReader: PipelineReader = {
  config: loadWoodpeckerConfig,
  json: woodpeckerJson,
};

export async function handoverJson(
  command: string[],
  reader: PipelineReader = pipelineReader,
): Promise<unknown> {
  if (command[0] === "toolkit" && command[1] === "woodpecker") {
    // Native pipeline ls emits a table even with --output json. Read its
    // authenticated API instead; retain exactly the existing quiescence query.
    const status = z
      .tuple([
        z.literal("toolkit"),
        z.literal("woodpecker"),
        z.literal("pipeline"),
        z.literal("ls"),
        z.literal("shepherdjerred/monorepo"),
        z.literal("--status"),
        PipelineStatus,
        z.literal("--limit"),
        z.literal("1"),
        z.literal("--output"),
        z.literal("json"),
      ])
      .parse(command)[6];
    const config = await reader.config();
    if (config.baseUrl !== "https://woodpecker.sjer.red" || config.repoId !== 1)
      throw new Error("Handover requires the canonical Woodpecker repository");
    return z
      .array(
        z.object({
          number: z.number().int().positive(),
          status: z.literal(status),
        }),
      )
      .max(1)
      .parse(
        await reader.json(
          `/api/repos/1/pipelines?status=${status}&perPage=1`,
          config,
        ),
      );
  }
  const result = await run(command, {
    capture: true,
    echoCapturedStdout: false,
    unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
  });
  return JSON.parse(result.stdout) as unknown;
}

export function assertHandoverWebhook(raw: unknown, expectedId: number) {
  const hooks = z
    .array(
      z.array(
        z.object({
          id: z.number().int().positive(),
          active: z.boolean(),
          config: z.object({ url: z.url() }),
        }),
      ),
    )
    .parse(raw)
    .flat();
  const matching = hooks.filter((hook) => {
    const url = new URL(hook.config.url);
    return (
      url.protocol === "https:" &&
      url.hostname === "woodpecker.sjer.red" &&
      url.pathname === "/api/hook"
    );
  });
  const selected = matching.find((hook) => hook.id === expectedId);
  if (selected === undefined || matching.some((hook) => hook.active))
    throw new Error(
      "The exact Woodpecker webhook and every matching hook must remain disabled during handover",
    );
  // Do not retain webhook config, query strings, or credentials in receipts.
  return {
    id: selected.id,
    active: false as const,
    origin: "https://woodpecker.sjer.red",
    path: "/api/hook",
  };
}

export async function handoverAutomation(
  descriptor: HandoverDescriptor,
  read = handoverJson,
) {
  const webhook = assertHandoverWebhook(
    await read([
      "gh",
      "api",
      "repos/shepherdjerred/monorepo/hooks",
      "--paginate",
      "--slurp",
    ]),
    descriptor.woodpeckerWebhookId,
  );
  for (const status of ["pending", "running", "blocked"]) {
    const pipelines = z
      .array(z.object({ number: z.number().int().positive() }))
      .parse(
        await read([
          "toolkit",
          "woodpecker",
          "pipeline",
          "ls",
          "shepherdjerred/monorepo",
          "--status",
          status,
          "--limit",
          "1",
          "--output",
          "json",
        ]),
      );
    if (pipelines.length > 0)
      throw new Error(`Native ${status} pipeline prevents authority handover`);
  }
  return webhook;
}
