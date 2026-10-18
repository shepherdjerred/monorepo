import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import type { HandoverDescriptor } from "./delivery-handover-selection.ts";

export async function handoverJson(command: string[]): Promise<unknown> {
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
      url.pathname === "/hook"
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
    path: "/hook",
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
