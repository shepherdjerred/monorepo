import { rm } from "node:fs/promises";
import { restoreProviderWorkspace } from "./provider-workspace.ts";
import { restoreCodexSubscriptionParentMode } from "./codex-home.ts";
import type { ProviderHomeParentMode } from "./provider-home.ts";

export async function cleanupCodexRun(input: {
  workdir: string;
  subscriptionAuthPath: string | undefined;
  subscriptionHome?: string | undefined;
  subscriptionParentMode?: ProviderHomeParentMode | undefined;
  providerWrapperDirectory: string | undefined;
  providerHomeDirectory?: string | undefined;
  parser: { finish: () => void };
  trace: { end: (outcome: "success" | "error" | "cancelled") => void };
  traceOutcome: "success" | "error" | "cancelled";
}): Promise<{ cause: unknown } | undefined> {
  let failure: { cause: unknown } | undefined;
  const operations = [
    () => restoreProviderWorkspace(input.workdir),
    async () => {
      if (input.subscriptionHome !== undefined) {
        await restoreProviderWorkspace(input.subscriptionHome);
      }
    },
    () => restoreCodexSubscriptionParentMode(input.subscriptionParentMode),
    async () => {
      if (input.subscriptionAuthPath !== undefined) {
        await rm(input.subscriptionAuthPath, { force: true });
      }
    },
    async () => {
      if (input.providerHomeDirectory !== undefined) {
        await rm(input.providerHomeDirectory, { recursive: true, force: true });
      }
    },
    async () => {
      if (input.providerWrapperDirectory !== undefined) {
        await rm(input.providerWrapperDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
    () => {
      input.parser.finish();
      return Promise.resolve();
    },
  ];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failure ??= { cause: error };
    }
  }
  try {
    input.trace.end(failure === undefined ? input.traceOutcome : "error");
  } catch (error: unknown) {
    failure ??= { cause: error };
  }
  return failure;
}
