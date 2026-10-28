import { expect, test } from "vitest";
import {
  AuthCheckpointSchema,
  assertAuthCheckpointAuthority,
} from "./checkpoint";

const authority = {
  runID: "12345678-1234-4234-9234-123456789abc",
  sourceHead: "a".repeat(40),
  remoteVaultID: "owned-vault",
  ownerBindingSHA256: "a".repeat(64),
  metadataSHA256: "b".repeat(64),
  profileCount: 0,
  sourceFilesSHA256: "c".repeat(64),
  appFilesSHA256: "d".repeat(64),
  runnerFilesSHA256: "e".repeat(64),
  inputArtifactsSHA256: "f".repeat(64),
  phaseProofs: { credentials: "a".repeat(64), verification: "b".repeat(64) },
};
const checkpoint = AuthCheckpointSchema.parse({
  ...authority,
  schemaVersion: 1,
  kind: "ios-account-auth-only-checkpoint",
  authEntryID: "22345678-1234-4234-9234-123456789abc",
  authSessionID: "32345678-1234-4234-9234-123456789abc",
  authOutcomeSHA256: "c".repeat(64),
  authEvidenceSHA256: "d".repeat(64),
});
test("checkpoint binds both phase proofs and the actual owner/source/app/Runner/helper identity", () => {
  expect(() =>
    assertAuthCheckpointAuthority(checkpoint, authority),
  ).not.toThrow();
  for (const field of [
    "ownerBindingSHA256",
    "metadataSHA256",
    "sourceFilesSHA256",
    "appFilesSHA256",
    "runnerFilesSHA256",
    "inputArtifactsSHA256",
  ])
    expect(() =>
      assertAuthCheckpointAuthority(checkpoint, {
        ...authority,
        [field]: "0".repeat(64),
      }),
    ).toThrow();
  expect(() =>
    assertAuthCheckpointAuthority(checkpoint, {
      ...authority,
      remoteVaultID: "another-vault",
    }),
  ).toThrow();
  expect(() =>
    assertAuthCheckpointAuthority(checkpoint, {
      ...authority,
      profileCount: 1,
    }),
  ).toThrow();
  expect(() =>
    assertAuthCheckpointAuthority(checkpoint, {
      ...authority,
      phaseProofs: { ...authority.phaseProofs, verification: "0".repeat(64) },
    }),
  ).toThrow();
});
test("checkpoint cannot smuggle account credentials or omit a complete evidence pin", () => {
  expect(() =>
    AuthCheckpointSchema.parse({ ...checkpoint, password: "public-fixture" }),
  ).toThrow();
  const { authEvidenceSHA256: _omitted, ...partial } = checkpoint;
  expect(() => AuthCheckpointSchema.parse(partial)).toThrow();
});
