#!/usr/bin/env bun

import { AgentTurnInputSchema } from "#src/domain/schemas.ts";
import { runCodexTurn } from "#src/agent/codex.ts";

async function readInput(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

function requireCredential(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Container credential ${name} is missing`);
  }
  return value;
}

async function main(): Promise<void> {
  const input = AgentTurnInputSchema.parse(JSON.parse(await readInput()));
  const output = await runCodexTurn({
    prompt: input.prompt,
    model: input.model,
    apiKey: requireCredential("OPENAI_API_KEY"),
  });
  process.stdout.write(`JPE_RESULT:${JSON.stringify(output)}\n`);
}

await main();
