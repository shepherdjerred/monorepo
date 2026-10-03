import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { createForumClient } from "./client.ts";
import os from "node:os";
import path from "node:path";
import { resolveForumIdentity } from "./identity.ts";
import { sessionForumCredentials } from "./sessions.ts";

export async function forumClientForAgent(agent: string, session?: string) {
  const identity = resolveForumIdentity(agent, session);
  const config = await loadToolkitConfig();
  const profiles = await config.value("forumProfiles");
  const reference = profiles[agent];
  if (reference === undefined)
    throw new Error(
      `Forum profile '${agent}' is not configured in ~/.toolkit/config.toml`,
    );
  const baseUrl = await config.value("forumUrl");
  const credentials = await sessionForumCredentials({
    identity,
    baseUrl,
    profileReference: reference,
    directory: path.join(os.homedir(), ".toolkit/forum"),
  });
  return {
    client: createForumClient({ baseUrl, apiKey: credentials.apiKey }),
    identity: credentials.identity,
  };
}
