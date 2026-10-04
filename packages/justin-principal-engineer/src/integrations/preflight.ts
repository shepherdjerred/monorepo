import { createCodexConfig } from "@shepherdjerred/llm-runtime";
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
  const { routeModelId } = createCodexConfig({
    apiKey,
    modelId: config.agents.codex.model,
  });
  const response = await request(
    `https://api.openai.com/v1/models/${encodeURIComponent(routeModelId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    // Provider error bodies can echo credentials. Report only the boundary.
    throw new Error(
      `OpenAI model access failed (HTTP ${String(response.status)}). Codex needs a native OpenAI credential with access to the configured model.`,
    );
  }
  const model = z.object({ id: z.string() }).parse(await response.json());
  if (model.id !== routeModelId)
    throw new Error("OpenAI returned a different model");
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
