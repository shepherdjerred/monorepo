import { describe, expect, test } from "vitest";
import { normalizeDotnetArgs } from "./dotnet.ts";

describe("normalizeDotnetArgs", () => {
  test.each(["--help", "-h", "-?"])(
    "lifts %s before -- on dotnet test and drops an empty trailing --",
    (flag) => {
      expect(
        normalizeDotnetArgs([
          "test",
          "--project",
          "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
          "--configuration",
          "Release",
          "--property:RestoreLockedMode=true",
          "--",
          flag,
        ]),
      ).toEqual([
        "test",
        "--project",
        "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
        "--configuration",
        "Release",
        "--property:RestoreLockedMode=true",
        flag,
      ]);
    },
  );

  test("preserves remaining forwarded arguments after -- when lifting --help", () => {
    expect(
      normalizeDotnetArgs([
        "test",
        "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
        "--",
        "--help",
        "--info",
      ]),
    ).toEqual([
      "test",
      "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
      "--help",
      "--",
      "--info",
    ]);
  });

  test("leaves non-help dotnet test invocations and non-test commands unchanged", () => {
    const filteredTest = [
      "test",
      "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
      "--",
      "--filter",
      "FullyQualifiedName~FacetBoundaryTests",
    ];
    expect(normalizeDotnetArgs(filteredTest)).toEqual(filteredTest);

    const runWithAppHelp = [
      "run",
      "--project",
      "src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
      "--",
      "--help",
    ];
    expect(normalizeDotnetArgs(runWithAppHelp)).toEqual(runWithAppHelp);

    const buildArgs = [
      "build",
      "TaskNotes.Windows.Portable.slnx",
      "--configuration",
      "Release",
    ];
    expect(normalizeDotnetArgs(buildArgs)).toEqual(buildArgs);
  });
});
