import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  RetentionClient,
  type RetentionRequest,
} from "./woodpecker-retention-client.ts";
import { retentionReferences } from "./woodpecker-retention-references.ts";

function required(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "")
    throw ApplicationFailure.nonRetryable(
      `${name} is required`,
      "RetentionBootstrapError",
    );
  return value;
}

export async function retentionClient(signal: AbortSignal, pulse: () => void) {
  const github = await createGitHubAppInstallationToken({
    fetch: async (url, init) => {
      signal.throwIfAborted();
      pulse();
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      signal.throwIfAborted();
      pulse();
      return response;
    },
  });
  const request =
    (
      base: string,
      token: () => Promise<string>,
      ca?: string,
    ): RetentionRequest =>
    async (path, method = "GET") => {
      signal.throwIfAborted();
      pulse();
      const response = await fetch(new URL(path, base), {
        method,
        headers: {
          Authorization: `Bearer ${await token()}`,
          Accept: "application/json",
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        ...(ca === undefined ? {} : { tls: { ca } }),
      });
      signal.throwIfAborted();
      pulse();
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw ApplicationFailure.nonRetryable(
          `Retention API rejected ${method} ${path.split("?").at(0) ?? ""} (HTTP ${String(response.status)})`,
          "RetentionAuthorizationOrContractError",
        );
      if (!response.ok)
        throw new Error(
          `Retention API returned HTTP ${String(response.status)}`,
        );
      if (method === "DELETE") {
        if (response.status !== 204)
          throw ApplicationFailure.nonRetryable(
            "Unexpected log-delete response",
            "RetentionContractError",
          );
        return null;
      }
      return response.json();
    };
  const woodpecker = request(required("WOODPECKER_URL"), () =>
    Promise.resolve(required("WOODPECKER_TOKEN")),
  );
  const githubRead = request(
    Bun.env["GITHUB_API_URL"] ?? "https://api.github.com",
    () => Promise.resolve(github.token),
  );
  const serviceAccount = "/var/run/secrets/kubernetes.io/serviceaccount";
  const ca = await Bun.file(`${serviceAccount}/ca.crt`).text();
  const kubernetes = request(
    `https://${required("KUBERNETES_SERVICE_HOST")}:${required("KUBERNETES_SERVICE_PORT")}`,
    async () => {
      const token = await Bun.file(`${serviceAccount}/token`).text();
      return token.trim();
    },
    ca,
  );
  return new RetentionClient(woodpecker, (repo) =>
    retentionReferences(repo, woodpecker, githubRead, kubernetes),
  );
}

const FatalConfigSourceErrorSchema = z.object({
  name: z.literal("ConfigSourceFatalError"),
});

export function stopOnRetentionContractError(error: unknown): never {
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    FatalConfigSourceErrorSchema.safeParse(error).success
  )
    throw ApplicationFailure.nonRetryable(
      "Retention API/config/receipt schema validation failed",
      "RetentionContractError",
    );
  throw error;
}
