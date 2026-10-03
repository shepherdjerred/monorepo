import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { createForumClient } from "./client.ts";

export async function forumClientForAgent(agent: string) {
  const config = await loadToolkitConfig();
  const profiles = await config.value("forumProfiles");
  const reference = profiles[agent];
  if (reference === undefined)
    throw new Error(
      `Forum profile '${agent}' is not configured in ~/.toolkit/config.toml`,
    );
  const child = Bun.spawn(["op", "read", reference], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 || output.trim().length === 0)
    throw new Error(`1Password could not read the forum key for '${agent}'`);
  return createForumClient({
    baseUrl: await config.value("forumUrl"),
    apiKey: output.trim(),
  });
}
