import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import { DEFAULT_KUBE_CONTEXT } from "#providers/kubernetes/kubectl.ts";

/**
 * Daemon settings, layered `env -> ~/.toolkit/config.toml -> default` like the
 * toolkit's own config (the daemon runs from a workstation checkout).
 */
export const MC_DAEMON_CONFIG_DEFINITION = {
  /**
   * kubeconfig context for cluster sandboxes. Explicit so a kubectl
   * `current-context` switch never redirects the harness.
   */
  mcKubeContext: {
    schema: z.string().min(1),
    sources: ["env", "file", "default"],
    default: DEFAULT_KUBE_CONTEXT,
  },
} as const;

export async function loadMcDaemonConfig() {
  return defineConfig({
    definition: MC_DAEMON_CONFIG_DEFINITION,
    sources: {
      env: createEnvSource(Bun.env),
      file: await createFileSource({
        path: path.join(os.homedir(), ".toolkit/config.toml"),
      }),
    },
  });
}
