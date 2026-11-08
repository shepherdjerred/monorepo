import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

function nativeKeyProof() {
  const file = path.resolve(
    import.meta.dir,
    "../../../tasknotes-fixtures/vault/upstream/obsidian-crypto.json",
  );
  const fixture = z
    .object({
      vectors: z.object({
        cases: z.array(
          z.object({
            version: z.number().int(),
            keyHashBytes: z.array(z.number().int().min(0).max(255)).length(32),
          }),
        ),
      }),
    })
    .parse(JSON.parse(readFileSync(file, "utf8")));
  const matching = fixture.vectors.cases.filter((item) => item.version === 3);
  const [native] = matching;
  if (native === undefined || matching.length !== 1)
    throw new Error("Public native encryption fixture is ambiguous or missing");
  return Buffer.from(native.keyHashBytes).toString("hex");
}

// These values are public synthetic inputs, never account credentials.
export const syntheticAccount = {
  email: "synthetic@example.test",
  password: "public-synthetic-password",
  verificationCode: "123456",
  name: "Facet protocol fixture",
} as const;
export const syntheticVault = {
  host: "sync-fixture.obsidian.md",
  salt: "ｖault-test-salt",
  password: "Å synthetic fixture １２３",
  encryption_version: 3,
  keyProof: nativeKeyProof(),
} as const;
export const pieceBytes = 2 * 1024 * 1024;
export const fileBytes = 8 * 1024 * 1024;
const natural = z.number().int().nonnegative();
const ciphertext = z
  .string()
  .regex(/^(?:[a-f0-9]{2})+$/u)
  .max(16_384);

export const InitSchema = z.strictObject({
  op: z.literal("init"),
  token: z.string().min(1).max(256),
  id: z.string().min(1).max(128),
  keyhash: z.string().regex(/^[a-f0-9]{64}$/u),
  version: natural,
  initial: z.boolean(),
  device: z.string().min(1).max(256),
  encryption_version: z.literal(3),
});
export const PushSchema = z
  .strictObject({
    op: z.literal("push"),
    path: ciphertext,
    relatedpath: ciphertext.nullable(),
    extension: z.string().max(64),
    hash: z.union([z.literal(""), ciphertext]),
    ctime: natural,
    mtime: natural,
    folder: z.boolean(),
    deleted: z.boolean(),
    size: natural.max(fileBytes + 28).optional(),
    pieces: natural.max(Math.ceil((fileBytes + 28) / pieceBytes)).optional(),
  })
  .superRefine((value, context) => {
    const marker = value.folder || value.deleted;
    const valid = marker
      ? value.size === undefined &&
        value.pieces === undefined &&
        value.hash === ""
      : value.size !== undefined &&
        value.pieces === Math.ceil(value.size / pieceBytes) &&
        value.hash !== "" &&
        (value.size === 0 || value.size > 28);
    if (!valid)
      context.addIssue({ code: "custom", message: "Invalid upload framing" });
  });
export const PullSchema = z.strictObject({
  op: z.literal("pull"),
  uid: natural.positive(),
});
export const PingSchema = z.strictObject({ op: z.literal("ping") });
export type Push = z.infer<typeof PushSchema>;
export type WireFile = Push & { uid: number; device: string };
export type FixtureProfile = "native" | "pinned-transcript-v3";

export function fixtureProfile(runID: string, profile: FixtureProfile) {
  z.uuid().parse(runID);
  z.enum(["native", "pinned-transcript-v3"]).parse(profile);
  return profile === "native"
    ? {
        vaultID: "fixture-vault-" + runID,
        keyProof: syntheticVault.keyProof,
        initialUID: 0,
      }
    : {
        vaultID: "synthetic-vault",
        keyProof:
          "7b607a09a573c6f5ed91659e0ad243621b420539a488c693b643a0571b4f6994",
        initialUID: 5,
      };
}

export const ControlSchema = z.strictObject({
  runID: z.uuid(),
  action: z.enum([
    "disconnect-all",
    "fail-next-push-before-commit",
    "fail-next-push-after-commit",
  ]),
});
