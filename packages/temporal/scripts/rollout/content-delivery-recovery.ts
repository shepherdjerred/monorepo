import { z } from "zod";
import { ForumStepAcknowledgementSchema } from "@shepherdjerred/ops-model/forum-recovery.ts";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
  requiredEnvironment,
} from "#scripts/cli-arguments.ts";
import {
  ContentActionSchema,
  ContentOperatorError,
} from "#lib/delivery/content-recovery/request.ts";
import { ContentRecoveryContextSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { recoverContentWithOperator } from "./content-delivery-recovery-operator.ts";
import { openOperatorRecovery } from "./temporal-operator-credentials.ts";

/** Operator bootstrap credentials stay in this process; native Jobs receive only
 * dedicated source-owned grants. No arbitrary selection, command or repair data.
 */
async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set([
      "--intent",
      "--url",
      "--context",
      "--action",
      "--acknowledge-step",
      "--expected-journal-sha256",
    ]),
  );
  const id = requiredParsedArgument(flags, "--intent");
  const action = ContentActionSchema.parse(
    requiredParsedArgument(flags, "--action"),
  );
  const acknowledgement =
    flags.has("--acknowledge-step") || flags.has("--expected-journal-sha256")
      ? ForumStepAcknowledgementSchema.parse({
          step: requiredParsedArgument(flags, "--acknowledge-step"),
          journalSha256: requiredParsedArgument(
            flags,
            "--expected-journal-sha256",
          ),
        })
      : undefined;
  if (acknowledgement !== undefined && action !== "repair")
    throw new ContentOperatorError(
      "Step acknowledgement requires --action repair",
    );
  const context = z
    .literal("admin@torvalds")
    .parse(requiredParsedArgument(flags, "--context"));
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN", "ARGOCD_AUTH_TOKEN"]);
  const selected = await deliveryRequest(
    `content-recovery/${encodeURIComponent(id)}`,
    ContentRecoveryContextSchema,
  );
  if (
    selected.intent.targetKind === "static-site" &&
    selected.intent.status === "pending"
  )
    await resolveCredentials([
      "DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID",
      "DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY",
      ...(action === "repair" ? ["CLOUDFLARE_API_TOKEN"] : []),
    ]);
  Bun.env["ARGOCD_TOKEN"] = requiredEnvironment(Bun.env, "ARGOCD_AUTH_TOKEN");
  Bun.env["ARGOCD_SERVER_URL"] = "https://argocd.sjer.red";
  const { kubernetes, connection } = await openOperatorRecovery(context);
  try {
    const result = await recoverContentWithOperator(id, action, {
      kubernetes,
      connection,
      ...(acknowledgement === undefined ? {} : { acknowledgement }),
      signal: AbortSignal.timeout(135 * 60_000),
      command: async (argv) => {
        const child = Bun.spawn([...argv], {
          stdout: "pipe",
          stderr: "pipe",
          env: Object.fromEntries(
            Object.entries(Bun.env).filter(
              ([key]) =>
                ![
                  "OP_SERVICE_ACCOUNT_TOKEN",
                  "DELIVERY_EXECUTOR_TOKEN",
                  "ARGOCD_AUTH_TOKEN",
                  "ARGOCD_TOKEN",
                ].includes(key),
            ),
          ),
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0)
          throw new Error("Operator read-only image/chart/poller proof failed");
        return { stdout, stderr };
      },
    });
    console.warn(JSON.stringify({ intentId: id, ...result }));
  } finally {
    await connection.close();
  }
}
try {
  await main();
} catch (error) {
  if (error instanceof ContentOperatorError) console.error(error.message);
  else
    console.error(
      "Independent content recovery refused or remains incomplete. Preserve the exact native receipts, original backup and quarantine; inspect the same intent before retrying.",
    );
  process.exitCode = 1;
}
