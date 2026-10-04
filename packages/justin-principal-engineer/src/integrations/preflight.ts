import { checkCodexModelAccess } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

import type { Config } from "#src/domain/schemas.ts";
import { readOpReference } from "#src/integrations/secrets.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

type Fetch = typeof fetch;

export async function checkOpenAi(
  config: Config,
  run: CommandRunner,
  request: Fetch = fetch,
): Promise<string> {
  const apiKey = await readOpReference(config.agents.codex.openAiApiKey, run);
  await checkCodexModelAccess(
    { apiKey, modelId: config.agents.codex.model },
    request,
  );
  return apiKey;
}

export async function checkConnections(
  config: Config,
  run: CommandRunner,
  request: Fetch = fetch,
): Promise<void> {
  await checkOpenAi(config, run, request);
  const token = await readOpReference(config.woodpecker.apiToken, run);
  const response = await request(
    new URL(
      `/api/repos/${String(config.woodpecker.repoId)}`,
      config.woodpecker.baseUrl,
    ),
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Woodpecker repository access failed (HTTP ${String(response.status)})`,
    );
  }
  const repository = z
    .object({ id: z.number().int(), full_name: z.string() })
    .parse(await response.json());
  if (
    repository.id !== config.woodpecker.repoId ||
    repository.full_name !== config.repository.slug
  ) {
    throw new Error("Woodpecker repository ID does not match repository.slug");
  }
}
