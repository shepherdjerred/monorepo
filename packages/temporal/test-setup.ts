import { afterAll } from "vitest";
import {
  installTemporalTestEnvironmentLifecycle,
  reapDirectTemporalTestServerChildren,
  teardownActiveTemporalEnvironments,
} from "#lib/fixtures/temporal-lease.ts";

installTemporalTestEnvironmentLifecycle();

process.once("exit", () => {
  reapDirectTemporalTestServerChildren();
});

afterAll(async () => {
  await teardownActiveTemporalEnvironments();
});
