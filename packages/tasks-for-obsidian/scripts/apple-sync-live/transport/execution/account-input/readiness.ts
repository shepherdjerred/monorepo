import assert from "node:assert/strict";
import { z } from "zod";

const credentialsStatus = z.object({
  runID: z.uuid().transform((value) => value.toLowerCase()),
  capturedAt: z.iso.datetime(),
  accountStage: z.literal("credentials"),
  accountBusy: z.literal(false),
  profiles: z.array(z.unknown()).length(0),
});
const normalOwner = z.object({
  ready: z.literal(true),
  runID: z.uuid().transform((value) => value.toLowerCase()),
  pid: z.number().int().positive(),
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().min(0).max(999_999),
  launchDate: z.number().positive(),
});

export function freshMacCredentialsStatus(
  value: unknown,
  runID: string,
  startedAt: number,
  now: number,
) {
  const parsed = credentialsStatus.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.runID !== z.uuid().parse(runID).toLowerCase()
  )
    return false;
  const capturedAt = Date.parse(parsed.data.capturedAt);
  return (
    capturedAt >= startedAt &&
    now - capturedAt >= -1000 &&
    now - capturedAt <= 5000
  );
}

type Readiness = {
  runID: string;
  readStatus: () => Promise<unknown>;
  clock?: () => number;
  pause?: () => Promise<void>;
};

export async function waitMacCredentialsStatus(
  options: Readiness,
  startedAt: number,
) {
  const clock = options.clock ?? Date.now;
  for (;;) {
    assert.ok(
      clock() - startedAt < 30_000,
      "Mac account publication did not become ready",
    );
    try {
      if (
        freshMacCredentialsStatus(
          await options.readStatus(),
          options.runID,
          startedAt,
          clock(),
        )
      )
        return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await (options.pause ?? (() => Bun.sleep(100)))();
  }
}

/** The caller supplies the existing normal launch; no private input occurs here. */
export async function prepareNormalMacAccount(
  options: Readiness & {
    launch: () => Promise<unknown>;
    inspectOwner: () => Promise<unknown>;
  },
) {
  const startedAt = (options.clock ?? Date.now)();
  await options.launch();
  await waitMacCredentialsStatus(options, startedAt);
  const owner = normalOwner.parse(await options.inspectOwner());
  assert.equal(owner.runID, z.uuid().parse(options.runID).toLowerCase());
  assert.ok(
    owner.launchDate * 1000 >= startedAt,
    "Normal account process predates its launch",
  );
  await waitMacCredentialsStatus(options, startedAt);
  return owner;
}
