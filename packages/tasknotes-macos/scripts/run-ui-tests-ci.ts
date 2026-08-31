import { runUiTests } from "./ui-test-harness.ts";

const identity = Bun.env["TASKNOTES_UITEST_IDENTITY"];
if (identity === undefined || !/^[0-9A-F]{40}$/u.test(identity)) {
  throw new Error(
    "TASKNOTES_UITEST_IDENTITY must be the SHA-1 of the CI Apple Development identity",
  );
}

// The bootstrap is shared with the local runner deliberately. CI previously
// shelled straight into xcodebuild with no server, vault or fixture, so
// InspectorEditingUITests could never pass here — it failed on a missing
// .build/ui-test-fixture.json, which its compile error had been masking.
const exitCode = await runUiTests({
  extraArguments: [`TASKNOTES_UITEST_IDENTITY=${identity}`],
});
if (exitCode !== 0) {
  throw new Error(`TaskNotes UI tests exited ${exitCode.toString()}`);
}
