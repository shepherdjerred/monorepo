import { z } from "zod";

// Schema for parsed dependency info from renovate comments
export const DependencyInfoSchema = z.object({
  name: z.string(),
  datasource: z.enum(["helm", "docker", "github-releases", "custom.papermc"]),
  registryUrl: z.string().optional(),
  oldVersion: z.string(),
  newVersion: z.string(),
});

export type DependencyInfo = z.infer<typeof DependencyInfoSchema>;

// Schema for ArtifactHub response
export const ArtifactHubSchema = z.object({
  links: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  repository: z
    .object({
      url: z.string().optional(),
    })
    .optional(),
});

// Schema for GitHub release response
export const GitHubReleaseSchema = z.object({
  body: z.string().optional(),
  html_url: z.string().optional(),
  tag_name: z.string().optional(),
});

export const GitHubReleasesArraySchema = z.array(GitHubReleaseSchema);

// Schema for release notes
export type ReleaseNotes = {
  dependency: string;
  version: string;
  notes: string;
  url?: string;
  source: "helm-chart" | "app" | "docker" | "github";
};

// Track failed fetches
export type FailedFetch = {
  dependency: string;
  reason: string;
};
