import { z } from "zod";
import {
  ActorSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import { hash } from "./files.ts";
import type { LinearExport } from "./schema.ts";

export const json = (value: unknown) =>
  z.record(z.string(), z.json()).parse(value);

export function lookup<T>(map: Map<string, T>, key: string, kind: string): T {
  const value = map.get(key);
  if (value === undefined)
    throw new Error("Missing exported " + kind + ": " + key);
  return value;
}

export function slug(name: string) {
  const value = name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u{300}-\u{36F}]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  if (value === "") throw new Error("Project name has no usable slug");
  return value;
}

/** Source account names do not prove which agent or human used a shared account. */
export function sourceActor(
  snapshot: LinearExport,
  userId: string | null,
): ActorEnvelope {
  if (userId === null)
    return ActorSchema.parse({
      key: "import:linear-unavailable-author",
      kind: "runner",
      name: "Linear (unavailable author)",
      metadata: { harness: "linear" },
    });
  const user = snapshot.users.find((item) => item.id === userId);
  if (user === undefined) throw new Error("Missing exported user: " + userId);
  if (userId === snapshot.sharedUserId)
    return ActorSchema.parse({
      key: "import:linear",
      kind: "runner",
      name: "Linear shared account (" + user.name + ")",
      metadata: { harness: "linear" },
    });
  return ActorSchema.parse({
    key: (user.app ? "agent:linear-" : "human:linear-") + user.id,
    kind: user.app ? "agent" : "human",
    name: user.name,
    metadata: { harness: "linear" },
  });
}

const MetadataValueSchema = z
  .string()
  .min(1)
  .refine((value) => !/^(?:unknown|n\/a|none)$/iu.test(value));
function known(value: string | undefined) {
  const parsed = MetadataValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function voteActor(
  body: string,
  externalId: string,
): ActorEnvelope | null {
  const lines = body.replaceAll(String.raw`\n`, "\n");
  if (lines.split("\n")[0]?.trim() !== "+1 hit again") return null;
  const field = (name: string) =>
    new RegExp(String.raw`^\s*-?\s*` + name + String.raw`:\s*(.*)$`, "imu")
      .exec(lines)?.[1]
      ?.trim()
      .replaceAll(/^['"\u{60}]|['"\u{60}]$/gu, "");
  const harness = known(field("Harness"));
  const session = known(field("Session"));
  const model = known(field("Model"));
  const namespace = harness === undefined ? "import" : slug(harness);
  const usableSession = session !== undefined && !/\s/u.test(session);
  const key = usableSession
    ? namespace + ":" + (session.length < 400 ? session : hash(session))
    : "import:linear-vote-" + externalId;
  return ActorSchema.parse({
    key,
    kind: "agent",
    name: usableSession
      ? (harness ?? "Imported agent session")
      : "Imported vote (unattributed)",
    metadata: {
      ...(harness === undefined ? {} : { harness }),
      ...(usableSession ? { sessionId: session } : {}),
      ...(model === undefined ? {} : { model }),
    },
  });
}
