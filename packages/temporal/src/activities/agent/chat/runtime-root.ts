import { mkdir, rm } from "node:fs/promises";

export const AGENT_CHAT_RUNTIME_ROOT = "/tmp/agent-chats";

export async function prepareAgentChatRuntimeRoot(
  runtimeRoot = AGENT_CHAT_RUNTIME_ROOT,
): Promise<void> {
  await rm(runtimeRoot, { recursive: true, force: true });
  // The root worker owns cleanup while the dropped provider UID must be able
  // to traverse into the one provider-owned chat directory active at a time.
  await mkdir(runtimeRoot, { recursive: true, mode: 0o711 });
}
