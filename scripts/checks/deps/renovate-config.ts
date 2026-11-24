/**
 * The renovate.json slice the Renovate configuration tests read, and the
 * subset of Renovate's packageRules matching they rely on.
 */
import { z } from "zod";

/** The repository root, where renovate.json lives. */
export const root = `${import.meta.dir}/../../..`;

export const RegexManagerSchema = z.object({
  description: z.string(),
  managerFilePatterns: z.array(z.string()),
  matchStrings: z.array(z.string()),
  depNameTemplate: z.string().optional(),
});

export const RenovateConfigSchema = z.object({
  dependencyDashboardApproval: z.boolean(),
  automerge: z.boolean(),
  automergeStrategy: z.string().optional(),
  platformAutomerge: z.boolean(),
  rebaseWhen: z.string(),
  vulnerabilityAlerts: z.object({
    enabled: z.boolean(),
  }),
  osvVulnerabilityAlerts: z.boolean(),
  env: z.record(z.string(), z.string()),
  mode: z.string().optional(),
  schedule: z.array(z.string()),
  commitHourlyLimit: z.number().optional(),
  prHourlyLimit: z.number(),
  prConcurrentLimit: z.number(),
  customManagers: z.array(RegexManagerSchema),
  packageRules: z.array(
    z.object({
      description: z.string().optional(),
      matchDatasources: z.array(z.string()).optional(),
      matchFileNames: z.array(z.string()).optional(),
      matchDepNames: z.array(z.string()).optional(),
      matchManagers: z.array(z.string()).optional(),
      matchNewValue: z.string().optional(),
      matchPackageNames: z.array(z.string()).optional(),
      allowedVersions: z.string().optional(),
      groupName: z.string().optional(),
      enabled: z.boolean().optional(),
      minimumReleaseAge: z.string().nullable().optional(),
      prBodyNotes: z.array(z.string()).optional(),
    }),
  ),
  ignorePaths: z.array(z.string()),
});

export type RenovateConfig = z.infer<typeof RenovateConfigSchema>;
export type RegexManager = z.infer<typeof RegexManagerSchema>;
export type PackageRule = RenovateConfig["packageRules"][number];

export async function loadRenovateConfig(): Promise<RenovateConfig> {
  return RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
}

// The slice of Renovate's packageRules matching these tests need: every
// matcher a rule states must hold, and a later rule's groupName wins.
export function matchesName(
  patterns: string[] | undefined,
  value: string,
): boolean {
  if (patterns === undefined) return true;
  return patterns.some((pattern) => {
    if (
      pattern.length > 2 &&
      pattern.startsWith("/") &&
      pattern.endsWith("/")
    ) {
      return new RegExp(pattern.slice(1, -1)).test(value);
    }
    return pattern.includes("*")
      ? new Bun.Glob(pattern).match(value)
      : pattern.toLowerCase() === value.toLowerCase();
  });
}

export type RuleSubject = {
  manager: string;
  file: string;
  datasource: string;
  depName: string;
  packageName: string;
};

export function groupNameFor(
  rules: PackageRule[],
  subject: RuleSubject,
): string | undefined {
  let groupName: string | undefined;
  for (const rule of rules) {
    if (rule.groupName === undefined) continue;
    if (rule.matchManagers?.includes(subject.manager) === false) continue;
    if (rule.matchDatasources?.includes(subject.datasource) === false) continue;
    if (!matchesName(rule.matchFileNames, subject.file)) continue;
    if (!matchesName(rule.matchPackageNames, subject.packageName)) continue;
    if (!matchesName(rule.matchDepNames, subject.depName)) continue;
    groupName = rule.groupName;
  }
  return groupName;
}
