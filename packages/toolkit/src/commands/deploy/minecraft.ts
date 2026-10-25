import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";

function removed(): never {
  throw new Error(
    "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
  );
}

export function validateMinecraftCommand(
  _positionals: string[],
  _options: DeployOptions,
) {
  removed();
}

export function runMinecraftCommand(
  _client: DeliveryClient,
  _positionals: string[],
  _options: DeployOptions & { requestNotice?: (id: string) => void },
): Promise<{ result: unknown; exitCode: number }> {
  return Promise.reject(
    new Error(
      "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
    ),
  );
}
