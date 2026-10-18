import type { z } from "zod";
import { forumNativeObservation as Recipe } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { DeliveryError } from "#domain/error.ts";
import { ForumRuntimeStatusSchema } from "#shared/forum-contract.ts";

export type NativeForumRequest = {
  namespace: string;
  pod: string;
  uid: string;
};
export type NativeForumReader = (
  input: NativeForumRequest,
) => Promise<z.infer<typeof ForumRuntimeStatusSchema>>;
export const FORUM_OBSERVER_KUBECONFIG = "/var/run/delivery-forum/kubeconfig";
const namespaces: readonly string[] = Recipe.namespaces;

export function forumObservationCommand(input: NativeForumRequest): string[] {
  if (
    !namespaces.includes(input.namespace) ||
    !/^storm-forum-web-[a-z0-9-]+$/u.test(input.pod) ||
    input.uid.length === 0
  )
    throw new DeliveryError(
      "INVALID",
      "Native forum observation requires the canonical original web Pod",
    );
  return [
    "kubectl",
    "--kubeconfig",
    FORUM_OBSERVER_KUBECONFIG,
    "--request-timeout=15s",
    "--namespace",
    input.namespace,
    "exec",
    input.pod,
    "--container",
    Recipe.container,
    "--",
    ...Recipe.command,
  ];
}

/** No shell, stdin, TTY, inherited credentials or caller-supplied PHP. Token remains in its projected file. */
export function createNativeForumReader(
  run: (command: string[]) => Promise<string> = runNative,
): NativeForumReader {
  return async (input) =>
    ForumRuntimeStatusSchema.parse(
      JSON.parse(await run(forumObservationCommand(input))),
    );
}
async function bounded(
  stream: ReadableStream<Uint8Array>,
  child: { kill: (signal?: number | NodeJS.Signals) => void },
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16 * 1024) {
        child.kill("SIGTERM");
        throw new DeliveryError(
          "INVALID",
          "Native forum observation exceeded its bounded output",
        );
      }
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}
async function runNative(command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 20_000);
  try {
    const [status, output] = await Promise.all([
      child.exited,
      bounded(child.stdout, child),
      bounded(child.stderr, child),
    ]);
    if (status !== 0)
      throw new DeliveryError(
        "PAUSED",
        "Protected native forum observation did not complete; retain the original owner",
      );
    return output;
  } finally {
    clearTimeout(timeout);
  }
}
