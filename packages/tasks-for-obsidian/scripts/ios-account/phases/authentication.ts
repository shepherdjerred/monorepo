import assert from "node:assert/strict";
import type { AccountInputClient } from "../connection";
import type { VerificationSource } from "../contract";
import { PrivatePhaseFailure } from "./failure";

type Client = Pick<
  AccountInputClient,
  | "stage"
  | "fill"
  | "submit"
  | "observe"
  | "fillVerification"
  | "submitVerification"
  | "finish"
>;
export type AuthDependencies = {
  validate: () => Promise<Record<string, unknown>>;
  readAccount: () => { email: string; password: string };
  verification: () => VerificationSource;
};
export async function authenticateOnly(
  session: Client,
  dependencies: AuthDependencies,
) {
  // Admission precedes every broker callback; this phase has no Connect capability.
  assert.ok(
    session.stage === "credentials" || session.stage === "verification",
  );
  if (session.stage === "credentials") {
    let value;
    try {
      value = dependencies.readAccount();
    } catch {
      throw new PrivatePhaseFailure("broker", "credentials");
    }
    await dependencies.validate();
    await session.fill(value);
    await session.submit();
    await session.observe();
  }
  if (session.stage === "verification") {
    const before = await dependencies.validate();
    let source;
    try {
      source = dependencies.verification();
    } catch {
      throw new PrivatePhaseFailure("broker", "verification");
    }
    const after = await dependencies.validate();
    assert.deepEqual(after["accountExchange"], before["accountExchange"]);
    await session.fillVerification(source);
    await session.submitVerification();
    await session.observe();
  }
  if (!["vaults"].includes(session.stage))
    throw new PrivatePhaseFailure("backend", "credentials");
  await dependencies.validate();
  const finished = await session.finish();
  assert.ok(finished.submitActionCount >= 1 && finished.submitActionCount <= 2);
  return { submitActionCount: finished.submitActionCount };
}
