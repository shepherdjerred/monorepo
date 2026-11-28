import { isDeclarationOnlyCSharpSource } from "./csharp-declaration-only.ts";

export type ComponentMetadata = {
  readonly projectPath: string;
  readonly projectDir: string;
  readonly assemblyName: string;
};

export type CoverageInclusionInput = {
  readonly relativePath: string;
  readonly component: string;
  readonly solutionXml: string;
  readonly csprojXml: string;
  readonly coverageSettingsXml: string;
};

export type DeclarationOnlyCheckInput = CoverageInclusionInput & {
  readonly sourceText: string;
};

export const COMPONENT_METADATA: Readonly<Record<string, ComponentMetadata>> = {
  "TaskNotes.Windows.Host": {
    projectPath: "src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj",
    projectDir: "packages/tasknotes-windows/src/TaskNotes.Windows.Host/",
    assemblyName: "TaskNotes.Windows.Host.dll",
  },
  "TaskNotes.Windows.Presentation": {
    projectPath:
      "src/TaskNotes.Windows.Presentation/TaskNotes.Windows.Presentation.csproj",
    projectDir:
      "packages/tasknotes-windows/src/TaskNotes.Windows.Presentation/",
    assemblyName: "TaskNotes.Windows.Presentation.dll",
  },
  "TaskNotes.Windows.AppAdapters": {
    projectPath: "src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
    projectDir: "packages/tasknotes-windows/src/TaskNotes.Windows.App/",
    assemblyName: "TaskNotes.Windows.App.dll",
  },
};

const APP_ADAPTER_FILES = new Set([
  "HotkeyBinding.cs",
  "ShellPreferencesCodec.cs",
  "UiOperationQueue.cs",
  "WinUiDispatcher.cs",
]);

export function componentForSource(relative: string): string | undefined {
  // Build manifests are tracked source but coverage can never instrument them.
  const normalized = relative.replaceAll("\\", "/");
  if (
    normalized.endsWith("/packages.lock.json") ||
    normalized.endsWith(".csproj") ||
    normalized.endsWith(".props") ||
    normalized.endsWith(".targets")
  ) {
    return undefined;
  }
  if (normalized.includes("/src/TaskNotes.Windows.Host/")) {
    return "TaskNotes.Windows.Host";
  }
  if (normalized.includes("/src/TaskNotes.Windows.Presentation/")) {
    return "TaskNotes.Windows.Presentation";
  }
  const appPrefix = "/src/TaskNotes.Windows.App/";
  const appIdx = normalized.indexOf(appPrefix);
  return appIdx !== -1 &&
    APP_ADAPTER_FILES.has(normalized.slice(appIdx + appPrefix.length))
    ? "TaskNotes.Windows.AppAdapters"
    : undefined;
}

function extractXmlTagPatterns(
  xml: string,
  sectionTag: string,
  modeTag: "Include" | "Exclude",
  itemTag: string,
): RegExp[] {
  const sectionMatch = new RegExp(
    String.raw`<${sectionTag}>([\s\S]*?)<\/${sectionTag}>`,
    "iu",
  ).exec(xml);
  const modeMatch =
    sectionMatch?.[1] === undefined
      ? null
      : new RegExp(String.raw`<${modeTag}>([\s\S]*?)<\/${modeTag}>`, "iu").exec(
          sectionMatch[1],
        );
  if (modeMatch?.[1] === undefined) {
    return [];
  }
  const patterns: RegExp[] = [];
  const itemRegex = new RegExp(
    String.raw`<${itemTag}>([^<]+)<\/${itemTag}>`,
    "giu",
  );
  for (const match of modeMatch[1].matchAll(itemRegex)) {
    const raw = match[1]?.trim();
    if (raw !== undefined && raw.length > 0) {
      patterns.push(new RegExp(raw, "iu"));
    }
  }
  return patterns;
}

function isExcludedByCsproj(csprojXml: string, relPath: string): boolean {
  const defaultsDisabled =
    /<EnableDefault(?:Compile)?Items>\s*false\s*<\/EnableDefault(?:Compile)?Items>/iu.test(
      csprojXml,
    );
  if (defaultsDisabled) {
    const includes = [
      ...csprojXml.matchAll(/<Compile\s[^>]*Include="([^"]+)"/giu),
    ];
    const included = includes.some((m) =>
      new Bun.Glob((m[1] ?? "").replaceAll("\\", "/")).match(relPath),
    );
    if (!included) {
      return true;
    }
  }
  const removes = [...csprojXml.matchAll(/<Compile\s[^>]*Remove="([^"]+)"/giu)];
  return removes.some((m) =>
    new Bun.Glob((m[1] ?? "").replaceAll("\\", "/")).match(relPath),
  );
}

export function isSourceIncludedInCoverage(
  input: CoverageInclusionInput,
): boolean {
  const meta = COMPONENT_METADATA[input.component];
  const normalized = input.relativePath.replaceAll("\\", "/");
  if (
    meta === undefined ||
    !normalized.endsWith(".cs") ||
    !normalized.startsWith(meta.projectDir) ||
    !input.solutionXml.includes(`Path="${meta.projectPath}"`) ||
    isExcludedByCsproj(
      input.csprojXml,
      normalized.slice(meta.projectDir.length),
    )
  ) {
    return false;
  }
  const modInc = extractXmlTagPatterns(
    input.coverageSettingsXml,
    "ModulePaths",
    "Include",
    "ModulePath",
  );
  const modExc = extractXmlTagPatterns(
    input.coverageSettingsXml,
    "ModulePaths",
    "Exclude",
    "ModulePath",
  );
  if (
    (modInc.length > 0 && !modInc.some((re) => re.test(meta.assemblyName))) ||
    modExc.some((re) => re.test(meta.assemblyName))
  ) {
    return false;
  }
  const srcInc = extractXmlTagPatterns(
    input.coverageSettingsXml,
    "Sources",
    "Include",
    "Source",
  );
  const srcExc = extractXmlTagPatterns(
    input.coverageSettingsXml,
    "Sources",
    "Exclude",
    "Source",
  );
  const winPath = normalized.replaceAll("/", "\\");
  const matchesAny = (list: readonly RegExp[]): boolean =>
    list.some((re) => re.test(normalized) || re.test(winPath));
  return (srcInc.length === 0 || matchesAny(srcInc)) && !matchesAny(srcExc);
}

export function isPermittedDeclarationOnlySource(
  input: DeclarationOnlyCheckInput,
): boolean {
  return (
    isSourceIncludedInCoverage(input) &&
    isDeclarationOnlyCSharpSource(input.sourceText)
  );
}
