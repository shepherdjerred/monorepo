import assert from "node:assert/strict";
import type { AccountInputClient } from "../connection";
import { PrivatePhaseFailure } from "./failure";

type Client = Pick<
  AccountInputClient,
  | "stage"
  | "canConnectWithoutPassword"
  | "fillVaultPassword"
  | "connect"
  | "observe"
  | "finish"
>;
export type ConnectDependencies = {
  admit: () => Promise<Record<string, unknown>>;
  readVaultPassword: () => string;
  connected: () => Promise<{ profiles: { profileID: string }[] }>;
};
/** Deliberately has no account/password-manager-login, OTP, or sign-in callbacks. */
export async function connectOnly(
  session: Client,
  remoteVaultID: string,
  profileID: string | undefined,
  dependencies: ConnectDependencies,
) {
  assert.equal(
    session.stage,
    "vaults",
    "Connect-only requires a restored vault-selection form",
  );
  const before = await dependencies.admit();
  if (!session.canConnectWithoutPassword) {
    let password;
    try {
      password = dependencies.readVaultPassword();
    } catch {
      throw new PrivatePhaseFailure("broker", "vault-password");
    }
    const after = await dependencies.admit();
    assert.deepEqual(after["accountExchange"], before["accountExchange"]);
    await session.fillVaultPassword(password);
  }
  await dependencies.admit();
  await session.connect(remoteVaultID, profileID);
  await session.observe();
  if (!["connected"].includes(session.stage))
    throw new PrivatePhaseFailure("backend", "connect");
  const status = await dependencies.connected(),
    profile = status.profiles[0];
  assert.ok(profile !== undefined);
  const finished = await session.finish();
  assert.equal(finished.submitActionCount, 1);
  return { profileID: profile.profileID, remoteVaultID, submitActionCount: 1 };
}
