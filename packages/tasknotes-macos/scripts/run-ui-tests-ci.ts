const identity = Bun.env["TASKNOTES_UITEST_IDENTITY"];
if (identity === undefined || !/^[0-9A-F]{40}$/u.test(identity)) {
  throw new Error(
    "TASKNOTES_UITEST_IDENTITY must be the SHA-1 of the CI Apple Development identity",
  );
}

const command = [
  "xcodebuild",
  "test",
  "-project",
  "TaskNotes.xcodeproj",
  "-scheme",
  "TaskNotes",
  "-configuration",
  "Debug",
  "-derivedDataPath",
  ".build/xcode",
  "-destination",
  "platform=macOS",
  "-only-testing:TaskNotesUITests",
  `TASKNOTES_UITEST_IDENTITY=${identity}`,
];

const child = Bun.spawn(command, {
  cwd: new URL("..", import.meta.url).pathname,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) {
  throw new Error(`TaskNotes UI tests exited ${exitCode.toString()}`);
}
