import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { RemediationScope } from "./remediation.ts";

const ArgsSchema = z
  .object({
    owner: z.string().min(1).optional(),
    device: z.string().min(1).optional(),
    apply: z.boolean(),
  })
  .refine(
    (args) => (args.owner === undefined) === (args.device !== undefined),
    {
      message: "Pass exactly one of --owner <userId> or --device <deviceId>",
    },
  );

export type RemediationArgs = {
  readonly scope: RemediationScope;
  readonly apply: boolean;
};

/** `--dry-run` is the default; `--apply` is required to change anything. */
export function parseRemediationArgs(argv: readonly string[]): RemediationArgs {
  const values: { owner?: string; device?: string } = {};
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        apply = false;
        break;
      case "--owner":
      case "--device": {
        const value = argv[index + 1];
        if (value === undefined) throw new Error(`${arg} requires a value`);
        values[arg === "--owner" ? "owner" : "device"] = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const parsed = ArgsSchema.parse({ ...values, apply });
  if (parsed.owner !== undefined) {
    return {
      apply,
      scope: {
        kind: "owner",
        ownerId: DiscordAccountIdSchema.parse(parsed.owner),
      },
    };
  }
  return { apply, scope: { kind: "device", deviceId: parsed.device ?? "" } };
}
