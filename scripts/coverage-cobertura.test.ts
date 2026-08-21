import { expect, test } from "vitest";
import path from "node:path";
import {
  coverageArtifactFilename,
  dotnetCoverageArguments,
  type TestStep,
} from "./ci-reporting.ts";
import {
  parseCobertura,
  summarizeCoverageReports,
} from "./coverage-reporting.ts";
import {
  coverableWorkspaceSources,
  isInstrumentableSource,
  resolveCoverageSource,
} from "./coverage-source-inventory.ts";

test("parses Cobertura lines and condition coverage", () => {
  const report = parseCobertura(`
    <coverage>
      <sources><source>/build/repo/packages/tasknotes-windows</source></sources>
      <packages><package><classes>
        <class filename="src/Native.cs"><lines>
          <line number="10" hits="2" />
          <line number="11" hits="0" branch="true" condition-coverage="50% (1/2)" />
        </lines></class>
        <class filename="src/Other.cs"><lines>
          <line number="3" hits="1" />
        </lines></class>
      </classes></package></packages>
    </coverage>
  `);

  expect(report.points).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        metric: "lines",
        source: "/build/repo/packages/tasknotes-windows/src/Native.cs",
        location: "10",
        covered: true,
      }),
      expect.objectContaining({
        metric: "branches",
        source: "/build/repo/packages/tasknotes-windows/src/Native.cs",
        location: "11:0",
        covered: true,
        identity: "anonymous-summary",
      }),
      expect.objectContaining({
        metric: "branches",
        source: "/build/repo/packages/tasknotes-windows/src/Native.cs",
        location: "11:1",
        covered: false,
      }),
    ]),
  );
  expect(report.unavailableMetrics).toEqual(["statements", "functions"]);
});

test("keeps Cobertura branches unavailable when sources overlap", () => {
  const cobertura = `
    <coverage><packages><package><classes><class filename="src/Native.cs"><lines>
      <line number="11" hits="1" branch="true" condition-coverage="50% (1/2)" />
    </lines></class></classes></package></packages></coverage>
  `;
  const summary = summarizeCoverageReports([
    parseCobertura(cobertura),
    parseCobertura(cobertura),
  ]);

  expect(summary.lines).toEqual({ covered: 1, total: 1 });
  expect(summary.branches).toBeUndefined();
  expect(summary.unavailableMetrics).toEqual([
    "statements",
    "functions",
    "branches",
  ]);
});

test("rejects malformed Cobertura branch coverage", () => {
  expect(() =>
    parseCobertura(`
      <coverage><packages><package><classes><class filename="src/Native.cs"><lines>
        <line number="11" hits="1" branch="true" condition-coverage="50%" />
      </lines></class></classes></package></packages></coverage>
    `),
  ).toThrow("Unrecognized Cobertura condition coverage");
});

test("maps absolute Cobertura paths back into the workspace", () => {
  expect(
    resolveCoverageSource(
      "/repo",
      "packages/tasknotes-windows",
      "/build/repo/packages/tasknotes-windows/src/Native.cs",
    ),
  ).toBe(path.join("/repo", "packages/tasknotes-windows/src/Native.cs"));
});

test("inventories reported C# sources without Istanbul instrumentation", () => {
  expect(
    coverableWorkspaceSources(
      ["packages/tasknotes-windows"],
      ["packages/tasknotes-windows"],
      [
        "packages/tasknotes-windows/src/Native.cs",
        "packages/tasknotes-windows/src/Native.test.cs",
      ],
    ),
  ).toEqual(["packages/tasknotes-windows/src/Native.cs"]);
  expect(
    isInstrumentableSource("packages/tasknotes-windows/src/Native.cs"),
  ).toBe(false);
});

test("declares .NET Cobertura artifacts and arguments", () => {
  const step = {
    runner: "dotnet",
    args: ["tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj"],
    coverageConfig: "coverage.settings.xml",
  } satisfies Extract<TestStep, { runner: "dotnet" }>;
  expect(coverageArtifactFilename(step)).toBe("coverage.cobertura.xml");
  expect(
    dotnetCoverageArguments(step, "/reports/raw/dotnet-1", "/repo"),
  ).toEqual([
    "--coverage",
    "--coverage-output",
    path.join("/reports/raw/dotnet-1", "coverage.cobertura.xml"),
    "--coverage-output-format",
    "cobertura",
    "--coverage-settings",
    path.join("/repo", "coverage.settings.xml"),
  ]);
});
