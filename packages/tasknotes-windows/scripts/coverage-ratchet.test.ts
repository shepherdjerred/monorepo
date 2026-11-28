import path from "node:path";
import { describe, expect, test } from "vitest";
import { changedLines } from "./coverage-ratchet.ts";
import {
  componentForSource,
  isPermittedDeclarationOnlySource,
  isSourceIncludedInCoverage,
} from "./lib/coverage-source-inclusion.ts";
import { isDeclarationOnlyCSharpSource } from "./lib/csharp-declaration-only.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");

const portableSolutionXml = `<Solution>
  <Folder Name="/src/">
    <Project Path="src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj" />
    <Project Path="src/TaskNotes.Windows.Presentation/TaskNotes.Windows.Presentation.csproj" />
  </Folder>
</Solution>`;

const defaultHostCsproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <AssemblyName>TaskNotes.Windows.Host</AssemblyName>
  </PropertyGroup>
</Project>`;

const defaultCoverageSettings = String.raw`<?xml version="1.0" encoding="utf-8"?>
<Configuration>
  <CodeCoverage>
    <ModulePaths>
      <Include>
        <ModulePath>.*TaskNotes\.Windows\.(Host|Presentation|App|App\.Tests)\.dll$</ModulePath>
      </Include>
      <Exclude>
        <ModulePath>.*TaskNotes\.Core\.Bindings\.dll$</ModulePath>
      </Exclude>
    </ModulePaths>
    <Sources>
      <Exclude>
        <Source>.*\\(bin|obj)\\.*</Source>
      </Exclude>
    </Sources>
  </CodeCoverage>
</Configuration>`;

describe("C# declaration-only syntax classification", () => {
  test("accepts pure interfaces, enums, delegates, const-only classes, abstract contracts, and AssemblyInfo", async () => {
    const realInterface = await Bun.file(
      path.join(packageRoot, "src/TaskNotes.Windows.Host/ITaskNotesStore.cs"),
    ).text();
    const realAssemblyInfo = await Bun.file(
      path.join(
        packageRoot,
        "src/TaskNotes.Windows.Host/Properties/AssemblyInfo.cs",
      ),
    ).text();

    expect(isDeclarationOnlyCSharpSource(realInterface)).toBe(true);
    expect(isDeclarationOnlyCSharpSource(realAssemblyInfo)).toBe(true);

    expect(
      isDeclarationOnlyCSharpSource(`
        #nullable enable
        using System;

        namespace TaskNotes.Windows.Host;

        [Flags]
        public enum SyncCapability : byte
        {
            None = 0,
            Pull = 1 << 0,
            Push = 1 << 1,
        }

        public delegate ValueTask SyncObserver(string cursor, CancellationToken token = default);

        public interface IFacetTrackingStore
        {
            event EventHandler? Changed;
            string? ActiveCursor { get; }
            string this[int index] { get; set; }
            Task RecordReceiptAsync(string id, string note = "x => y { z }", CancellationToken ct = default);
        }
      `),
    ).toBe(true);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;

        public static class ProtocolHeaderNames
        {
            public const string RequestId = "X-Request-Id";
            public const int SchemaVersion = 1;
        }

        public abstract class AbstractTransportContract
        {
            public abstract string Endpoint { get; }
            public abstract event EventHandler? Disconnected;
            public abstract Task ConnectAsync(CancellationToken cancellationToken = default);
        }
      `),
    ).toBe(true);
  });

  test("rejects default interface bodies, records, structs, auto-properties, and method bodies", async () => {
    const applicationContracts = await Bun.file(
      path.join(
        packageRoot,
        "src/TaskNotes.Windows.Presentation/ApplicationContracts.cs",
      ),
    ).text();
    const automationIds = await Bun.file(
      path.join(packageRoot, "src/TaskNotes.Windows.Host/AutomationIds.cs"),
    ).text();

    expect(isDeclarationOnlyCSharpSource(applicationContracts)).toBe(false);
    expect(isDeclarationOnlyCSharpSource(automationIds)).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public interface IWithDefaultMethod
        {
            void Ping() { Console.WriteLine("hi"); }
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public interface IWithExpressionDefault
        {
            int Version => 1;
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public interface IWithAccessorBody
        {
            int Count { get { return 0; } }
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public interface IWithStaticAutoProperty
        {
            static int Shared { get; set; }
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public sealed record ReceiptId(string Value);
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public sealed class MutableOptions
        {
            public string? Endpoint { get; set; }
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        namespace TaskNotes.Windows.Host;
        public sealed class PrimaryConstructed(int retries)
        {
            public const int Limit = 3;
        }
      `),
    ).toBe(false);

    expect(
      isDeclarationOnlyCSharpSource(`
        #if WINDOWS
        namespace TaskNotes.Windows.Host;
        public interface IConditional { void Run(); }
        #endif
      `),
    ).toBe(false);
  });
});

describe("coverage-ratchet project inclusion and diff line mapping", () => {
  test("enforces solution, csproj Compile Remove, and coverage.settings.xml inclusion", () => {
    const interfaceSource = `
      namespace TaskNotes.Windows.Host;
      public interface IFacetTrackingStore
      {
          Task TrackAsync(string id);
      }
    `;
    const relativePath =
      "packages/tasknotes-windows/src/TaskNotes.Windows.Host/IFacetTrackingStore.cs";

    expect(
      isPermittedDeclarationOnlySource({
        relativePath,
        component: "TaskNotes.Windows.Host",
        sourceText: interfaceSource,
        solutionXml: portableSolutionXml,
        csprojXml: defaultHostCsproj,
        coverageSettingsXml: defaultCoverageSettings,
      }),
    ).toBe(true);

    expect(
      isSourceIncludedInCoverage({
        relativePath,
        component: "TaskNotes.Windows.Host",
        solutionXml: "<Solution></Solution>",
        csprojXml: defaultHostCsproj,
        coverageSettingsXml: defaultCoverageSettings,
      }),
    ).toBe(false);

    expect(
      isPermittedDeclarationOnlySource({
        relativePath,
        component: "TaskNotes.Windows.Host",
        sourceText: interfaceSource,
        solutionXml: portableSolutionXml,
        csprojXml: `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><Compile Remove="IFacetTrackingStore.cs" /></ItemGroup></Project>`,
        coverageSettingsXml: defaultCoverageSettings,
      }),
    ).toBe(false);

    expect(
      isPermittedDeclarationOnlySource({
        relativePath:
          "packages/tasknotes-windows/src/TaskNotes.Windows.Host/ExcludedService.cs",
        component: "TaskNotes.Windows.Host",
        sourceText:
          "namespace TaskNotes.Windows.Host; public sealed class ExcludedService { public int Run() => 42; }",
        solutionXml: portableSolutionXml,
        csprojXml: `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><Compile Remove="ExcludedService.cs" /></ItemGroup></Project>`,
        coverageSettingsXml: defaultCoverageSettings,
      }),
    ).toBe(false);

    expect(
      isPermittedDeclarationOnlySource({
        relativePath,
        component: "TaskNotes.Windows.Host",
        sourceText: interfaceSource,
        solutionXml: portableSolutionXml,
        csprojXml: defaultHostCsproj,
        coverageSettingsXml: String.raw`<Configuration><CodeCoverage><Sources><Exclude><Source>.*IFacetTrackingStore\.cs$</Source></Exclude></Sources></CodeCoverage></Configuration>`,
      }),
    ).toBe(false);

    expect(
      isSourceIncludedInCoverage({
        relativePath,
        component: "TaskNotes.Windows.Host",
        solutionXml: portableSolutionXml,
        csprojXml: defaultHostCsproj,
        coverageSettingsXml: String.raw`<Configuration><CodeCoverage><ModulePaths><Exclude><ModulePath>.*TaskNotes\.Windows\.Host\.dll$</ModulePath></Exclude></ModulePaths></CodeCoverage></Configuration>`,
      }),
    ).toBe(false);
  });

  test("maps component sources and unified diff line numbers", () => {
    expect(
      componentForSource(
        "packages/tasknotes-windows/src/TaskNotes.Windows.Host/ITaskNotesStore.cs",
      ),
    ).toBe("TaskNotes.Windows.Host");
    expect(
      componentForSource(
        "packages/tasknotes-windows/src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj",
      ),
    ).toBeUndefined();
    expect([
      ...changedLines(
        "+++ b/packages/tasknotes-windows/src/TaskNotes.Windows.Host/Foo.cs\n@@ -1,0 +4,2 @@\n",
      ),
    ]).toEqual([
      "packages/tasknotes-windows/src/TaskNotes.Windows.Host/Foo.cs:4",
      "packages/tasknotes-windows/src/TaskNotes.Windows.Host/Foo.cs:5",
    ]);
  });
});
