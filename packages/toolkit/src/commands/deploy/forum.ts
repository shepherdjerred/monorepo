import {
  PublishForumBundleSchema,
  RequestForumBaselineSchema,
} from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";
import {
  runContentRecovery,
  validateContentRecovery,
} from "./content-recovery.ts";

export function deployMachineCredential(
  command: string,
  positionals: string[],
):
  | "DELIVERY_PUBLISHER_TOKEN"
  | "DELIVERY_API_TOKEN"
  | "DELIVERY_EXECUTOR_TOKEN" {
  if (command === "qualify") return "DELIVERY_EXECUTOR_TOKEN";
  return command === "forum" && positionals[0] === "publish"
    ? "DELIVERY_PUBLISHER_TOKEN"
    : "DELIVERY_API_TOKEN";
}

export function validateForumCommand(
  positionals: string[],
  options: DeployOptions,
) {
  const [action] = positionals;
  if (action === "recover" || action === "recovery") {
    validateContentRecovery("forum", positionals, options);
    return;
  }
  if (action === "inspect" && positionals.length === 2) return;
  if (!(
    (action === "publish" || action === "baseline") &&
    positionals.length === 1 &&
    options.file !== undefined
  ))
    throw new Error(
      "Use deploy forum publish|baseline --file <PATH> or forum inspect <BASELINE_ID>",
    );
  if (!options.machine)
    throw new Error(
      "Forum publication/baseline requires its explicit scoped --machine credential",
    );
}
export async function runForumCommand(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  const [action, target] = positionals;
  if (action === "recover" || action === "recovery")
    return runContentRecovery(client, positionals, options);
  if (action === "inspect") {
    if (target === undefined)
      throw new Error("Explicit forum baseline identity required");
    return { result: await client.forumBaseline(target), exitCode: 0 };
  }
  if (options.file === undefined)
    throw new Error("A reviewed forum descriptor file is required");
  const raw: unknown = await Bun.file(options.file).json();
  if (action === "publish") {
    const input = PublishForumBundleSchema.parse(raw);
    options.requestNotice?.(input.requestId);
    return { result: await client.publishForumBundle(input), exitCode: 0 };
  }
  const input = RequestForumBaselineSchema.parse(raw);
  options.requestNotice?.(input.requestId);
  return { result: await client.requestForumBaseline(input), exitCode: 0 };
}
