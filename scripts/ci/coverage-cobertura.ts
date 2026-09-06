import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { CoveragePoint, CoverageReport } from "./coverage-reporting.ts";

const CoberturaLineSchema = z.looseObject({
  "@_number": z.coerce.number().int().positive(),
  "@_hits": z.coerce.number().int().nonnegative(),
  "@_branch": z.string().optional(),
  "@_condition-coverage": z.string().optional(),
});
const CoberturaClassSchema = z.looseObject({
  "@_filename": z.string().min(1),
  lines: z.looseObject({ line: z.unknown() }).optional(),
});
const CoberturaPackageSchema = z.looseObject({
  classes: z.looseObject({ class: z.unknown() }).optional(),
});
const CoberturaDocumentSchema = z.object({
  coverage: z.looseObject({
    sources: z.looseObject({ source: z.unknown() }).optional(),
    packages: z.looseObject({ package: z.unknown() }).optional(),
  }),
});
const coberturaParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});
const unitCoverageWeight = 1;

function many(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function normalizeCoberturaPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function coberturaSourcePath(
  filename: string,
  sourceRoots: readonly string[],
): string {
  const normalizedFilename = normalizeCoberturaPath(filename);
  if (
    normalizedFilename.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalizedFilename)
  ) {
    return normalizedFilename;
  }
  if (sourceRoots.length === 1) {
    const root = normalizeCoberturaPath(sourceRoots[0] ?? "");
    if (root !== "." && root.length > 0) {
      return `${root.replace(/\/$/u, "")}/${normalizedFilename}`;
    }
  }
  return normalizedFilename;
}

function coberturaBranchCounts(
  rawConditionCoverage: string | undefined,
  source: string,
  lineNumber: number,
): { covered: number; total: number } | undefined {
  if (rawConditionCoverage === undefined) {
    return undefined;
  }
  const match = /\((\d+)\/(\d+)\)/u.exec(rawConditionCoverage);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Unrecognized Cobertura condition coverage '${rawConditionCoverage}' for ${source}:${lineNumber.toString()}`,
    );
  }
  const covered = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (covered > total) {
    throw new Error(
      `Cobertura condition coverage exceeds its total for ${source}:${lineNumber.toString()}`,
    );
  }
  return { covered, total };
}

function addCoveragePoint(
  points: Map<string, CoveragePoint>,
  point: CoveragePoint,
): void {
  const key = [point.metric, point.source, point.location].join("\u{0}");
  const existing = points.get(key);
  if (existing !== undefined && existing.weight !== point.weight) {
    throw new Error(`Coverage point ${key} has inconsistent weights`);
  }
  points.set(key, {
    ...point,
    covered: point.covered || existing?.covered === true,
  });
}

export function parseCobertura(contents: string): CoverageReport {
  const parsed: unknown = coberturaParser.parse(contents);
  const document = CoberturaDocumentSchema.parse(parsed);
  const sourceRoots =
    document.coverage.sources?.source === undefined
      ? []
      : many(document.coverage.sources.source).map((source) =>
          z.string().parse(source),
        );
  const points = new Map<string, CoveragePoint>();
  const packages =
    document.coverage.packages?.package === undefined
      ? []
      : many(document.coverage.packages.package);
  for (const packageValue of packages) {
    const packageValueParsed = CoberturaPackageSchema.parse(packageValue);
    const classes =
      packageValueParsed.classes?.class === undefined
        ? []
        : many(packageValueParsed.classes.class);
    for (const classValue of classes) {
      const classReading = CoberturaClassSchema.parse(classValue);
      const source = coberturaSourcePath(
        classReading["@_filename"],
        sourceRoots,
      );
      const lines =
        classReading.lines?.line === undefined
          ? []
          : many(classReading.lines.line);
      for (const lineValue of lines) {
        const line = CoberturaLineSchema.parse(lineValue);
        const lineNumber = line["@_number"];
        addCoveragePoint(points, {
          metric: "lines",
          source,
          location: lineNumber.toString(),
          covered: line["@_hits"] > 0,
          weight: unitCoverageWeight,
        });
        const branchCounts = coberturaBranchCounts(
          line["@_condition-coverage"],
          source,
          lineNumber,
        );
        if (branchCounts === undefined && line["@_branch"] === "true") {
          throw new Error(
            `Cobertura branch line ${source}:${lineNumber.toString()} has no condition coverage`,
          );
        }
        if (branchCounts === undefined) {
          continue;
        }
        for (
          let branchIndex = 0;
          branchIndex < branchCounts.total;
          branchIndex += 1
        ) {
          addCoveragePoint(points, {
            metric: "branches",
            source,
            location: `${lineNumber.toString()}:${branchIndex.toString()}`,
            covered: branchIndex < branchCounts.covered,
            weight: unitCoverageWeight,
            identity: "anonymous-summary",
          });
        }
      }
    }
  }
  if (![...points.values()].some((point) => point.metric === "lines")) {
    throw new Error("Cobertura report contains no line coverage records");
  }
  return {
    points: [...points.values()],
    unavailableMetrics: ["statements", "functions"],
  };
}
