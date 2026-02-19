import type { Secret } from "@dagger.io/dagger";
import { z } from "zod";
import type { StepResult } from "./homelab-index.ts";
import { getCurlContainer } from "./lib-curl.ts";

/**
 * Zod schema for ArgoCD sync response.
 */
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

/**
 * Extract sync info fields from validated ArgoCD response data.
 */
function extractSyncInfo(data: z.infer<typeof ArgocdResponseSchema>): {
  phase: string;
  health: string;
  revision: string;
  resourcesCount: number;
  message: string;
} {
  const status = data.status;
  return {
    phase: status?.sync?.status ?? "Unknown",
    health: status?.health?.status ?? "Unknown",
    revision: status?.sync?.revision?.slice(0, 8) ?? "Unknown",
    resourcesCount: status?.resources?.length ?? 0,
    message:
      status?.conditions?.[0]?.message ??
      data.message ??
      "Sync operation completed",
  };
}

/**
 * Parse the ArgoCD sync response body into a human-readable message.
 */
function parseArgocdResponse(bodyRaw: string): string {
  try {
    const parsed = JSON.parse(bodyRaw) as unknown;
    const result = ArgocdResponseSchema.safeParse(parsed);

    if (!result.success) {
      return `Response validation failed: ${bodyRaw}`;
    }

    const syncInfo = extractSyncInfo(result.data);
    return `Phase: ${syncInfo.phase}, Health: ${syncInfo.health}, Revision: ${syncInfo.revision}, Resources: ${String(syncInfo.resourcesCount)}\n${syncInfo.message}`;
  } catch {
    // Fallback to raw body if not JSON
    return bodyRaw;
  }
}

/**
 * Determine the StepResult from a status code and parsed message.
 */
function buildSyncResult(statusCode: string, message: string): StepResult {
  if (statusCode.startsWith("2")) {
    return { status: "passed", message };
  }
  if (message.includes("another operation is already in progress")) {
    return {
      status: "passed",
      message: `Sync already in progress (skipped): ${message}`,
    };
  }
  return { status: "failed", message };
}

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
      String.raw`curl -s -w '\n%{http_code}' -X POST ${argocdServer}/api/v1/applications/${appName}/sync ` +
        '-H "Authorization: Bearer $ARGOCD_TOKEN" ' +
        "-H 'Content-Type: application/json' > /tmp/result.txt 2>&1",
    ]);
  const output = await container.file("/tmp/result.txt").contents();

  // Split output into body and status code
  const lastNewline = output.lastIndexOf("\n");
  const bodyRaw = output.slice(0, lastNewline);
  const statusCode = output.slice(lastNewline + 1).trim();

  const message = parseArgocdResponse(bodyRaw);
  return buildSyncResult(statusCode, message);
}
