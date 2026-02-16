import { Secret } from "@dagger.io/dagger";
import { z } from "zod";
import type { StepResult } from "./index";
import { getCurlContainer } from "./base";

/**
 * Triggers a sync operation on the ArgoCD application using the provided token as a Dagger Secret.
 * Uses caching for improved performance.
 * @param argocdToken The ArgoCD API token for authentication (as a Dagger Secret).
 * @param argocdServer The ArgoCD server URL (defaults to hardcoded value for now).
 * @param appName The ArgoCD application name to sync (defaults to "apps").
 * @returns A StepResult object with status and message.
 */
export async function sync(
  argocdToken: Secret,
  argocdServer = "https://argocd.tailnet-1a49.ts.net",
  appName = "apps",
): Promise<StepResult> {
  // Use curl to get both the response body and HTTP status code
  // Write to file then read to avoid Dagger SDK URLSearchParams.toJSON bug
  const container = getCurlContainer()
    .withSecretVariable("ARGOCD_TOKEN", argocdToken)
    .withExec([
      "sh",
      "-c",
      // Output: body\nHTTP_CODE
      `curl -s -w '\\n%{http_code}' -X POST ${argocdServer}/api/v1/applications/${appName}/sync ` +
        '-H "Authorization: Bearer $ARGOCD_TOKEN" ' +
        "-H 'Content-Type: application/json' > /tmp/result.txt 2>&1",
    ]);
  const output = await container.file("/tmp/result.txt").contents();

  // Split output into body and status code
  const lastNewline = output.lastIndexOf("\n");
  const bodyRaw = output.slice(0, lastNewline);
  const statusCode = output.slice(lastNewline + 1).trim();
  let message: string;
  try {
    // Define Zod schema for ArgoCD sync response
    const ArgocdResponseSchema = z.object({
      status: z
        .object({
          sync: z
            .object({
              status: z.string().optional(),
              revision: z.string().optional(),
            })
            .optional(),
          health: z
            .object({
              status: z.string().optional(),
            })
            .optional(),
          resources: z.array(z.unknown()).optional(),
          conditions: z
            .array(
              z.object({
                message: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      message: z.string().optional(),
    });

    // Parse and validate the JSON response
    const parsed = JSON.parse(bodyRaw) as unknown;
    const result = ArgocdResponseSchema.safeParse(parsed);

    if (result.success) {
      const typedParsed = result.data;

      // Extract concise sync information instead of dumping entire JSON
      const syncInfo = {
        phase: typedParsed.status?.sync?.status ?? "Unknown",
        health: typedParsed.status?.health?.status ?? "Unknown",
        revision: typedParsed.status?.sync?.revision?.slice(0, 8) ?? "Unknown",
        resourcesCount: typedParsed.status?.resources?.length ?? 0,
        message: typedParsed.status?.conditions?.[0]?.message ?? typedParsed.message ?? "Sync operation completed",
      };
      message = `Phase: ${syncInfo.phase}, Health: ${syncInfo.health}, Revision: ${syncInfo.revision}, Resources: ${String(syncInfo.resourcesCount)}\n${syncInfo.message}`;
    } else {
      // Schema validation failed, use raw body
      message = `Response validation failed: ${bodyRaw}`;
    }
  } catch {
    // Fallback to raw body if not JSON
    message = bodyRaw;
  }
  if (statusCode.startsWith("2")) {
    return { status: "passed", message };
  } else if (message.includes("another operation is already in progress")) {
    // Another sync is already running - this is fine, not a failure
    return { status: "passed", message: `Sync already in progress (skipped): ${message}` };
  } else {
    return { status: "failed", message };
  }
}
