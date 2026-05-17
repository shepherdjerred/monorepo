import { afterEach, describe, expect, it } from "bun:test";
import { classifyHomelabAuditPreflight } from "./homelab-audit-preflight.ts";
import { homelabAuditActivities } from "./homelab-audit.ts";

const ORIGINAL_FETCH = globalThis.fetch;

const ARCHIVE_ENV_KEYS = [
  "HOMELAB_AUDIT_ARCHIVE_BUCKET",
  "HOMELAB_AUDIT_ARCHIVE_PREFIX",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
] as const;

const originalEnv = new Map<string, string | undefined>(
  ARCHIVE_ENV_KEYS.map((key) => [key, Bun.env[key]]),
);

type FetchInput = Parameters<typeof fetch>[0];

function installFetchMock(
  handler: (input: FetchInput) => Promise<Response>,
): void {
  const fetchMock: typeof fetch = Object.assign(
    async (input: FetchInput) => handler(input),
    { preconnect: ORIGINAL_FETCH.preconnect },
  );
  globalThis.fetch = fetchMock;
}

function fetchInputToUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ARCHIVE_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      Reflect.deleteProperty(Bun.env, key);
    } else {
      Bun.env[key] = value;
    }
  }
});

describe("homelabAuditActivities", () => {
  it("exposes the activities the workflow proxies", () => {
    expect(typeof homelabAuditActivities.runHomelabAuditPreflight).toBe(
      "function",
    );
    expect(typeof homelabAuditActivities.runHomelabAuditAgent).toBe("function");
    expect(typeof homelabAuditActivities.archiveHomelabAuditBody).toBe(
      "function",
    );
    expect(typeof homelabAuditActivities.sendHomelabAuditEmail).toBe(
      "function",
    );
    expect(typeof homelabAuditActivities.archiveHomelabAuditMetadata).toBe(
      "function",
    );
  });

  it("classifies missing tools and env as fatal preflight failures", () => {
    const result = classifyHomelabAuditPreflight({
      missingBinaries: ["bk", "temporal"],
      missingEnvGroups: ["BUILDKITE_API_TOKEN"],
      remoteWarnings: ["Bugsink: exit 1"],
    });

    expect(result.fatalMessages).toEqual([
      "Missing required audit binaries: bk, temporal",
      "Missing required audit environment: BUILDKITE_API_TOKEN",
    ]);
    expect(result.markdown).toContain("Bugsink: exit 1");
  });

  it("archives markdown and html audit bodies to S3", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      requestedUrls.push(fetchInputToUrl(input));
      return new Response("", { status: 200 });
    });
    Bun.env["HOMELAB_AUDIT_ARCHIVE_BUCKET"] = "audit-bucket";
    Bun.env["HOMELAB_AUDIT_ARCHIVE_PREFIX"] = "homelab-audits";
    Bun.env["AWS_ACCESS_KEY_ID"] = "access";
    Bun.env["AWS_SECRET_ACCESS_KEY"] = "secret";
    Bun.env["S3_ENDPOINT"] = "https://s3.example.test";
    Bun.env["S3_REGION"] = "us-east-1";
    Bun.env["S3_FORCE_PATH_STYLE"] = "true";

    const result = await homelabAuditActivities.archiveHomelabAuditBody({
      date: "2026-05-17",
      markdown: "# Homelab Health Audit — 2026-05-17\n\nbody",
    });

    expect(result.markdownKey).toBe(
      "homelab-audits/2026/05/17/manual-2026-05-17/local/audit.md",
    );
    expect(result.htmlKey).toBe(
      "homelab-audits/2026/05/17/manual-2026-05-17/local/audit.html",
    );
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls).toContain(
      "https://s3.example.test/audit-bucket/homelab-audits/2026/05/17/manual-2026-05-17/local/audit.md",
    );
    expect(requestedUrls).toContain(
      "https://s3.example.test/audit-bucket/homelab-audits/2026/05/17/manual-2026-05-17/local/audit.html",
    );
  });
});
